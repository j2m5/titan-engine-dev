import { describe, it, expect, vi, beforeEach } from 'vitest'

interface FakeTimeline {
  steps: Record<string, unknown>[]
  add: (params: Record<string, unknown>) => FakeTimeline
  pause: ReturnType<typeof vi.fn>
}

const timelines: FakeTimeline[] = []

vi.mock('animejs', () => {
  const timeline = vi.fn((): FakeTimeline => {
    const tl: FakeTimeline = {
      steps: [],
      add(params: Record<string, unknown>): FakeTimeline {
        tl.steps.push(params)

        return tl
      },
      pause: vi.fn()
    }

    timelines.push(tl)

    return tl
  })

  return { default: Object.assign(vi.fn(), { timeline }) }
})

import { PerspectiveCamera, Vector3 } from 'three'
import { CameraToObjectTransition, decideFlight } from '@/core/transitions/CameraToObjectTransition'
import type { SceneObserver, ObservableRecord } from '@/core/services/SceneObserver'
import type { CameraController } from '@/core/camera/CameraController'
import type { NotificationSink, SystemNotification } from '@/core/ports/NotificationSink'
import type { MenuController } from '@/core/ports/MenuController'
import type { AstroControls } from '@/core/libs/AstroControls'
import type { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'

/** Абстрактная точка прилёта для чистой функции решения */
const ARRIVAL_DISTANCE = 300

describe('decideFlight', () => {
  it('нет полёта и камера далеко — лететь', () => {
    expect(decideFlight(null, 'Mars', 5000, ARRIVAL_DISTANCE, 1)).toBe('start')
  })

  it('во время полёта к тому же объекту — повторный клик игнорируется', () => {
    expect(decideFlight('Mars', 'Mars', 5000, ARRIVAL_DISTANCE, 1)).toBe('ignore')
  })

  it('во время полёта к другому объекту — разворот', () => {
    expect(decideFlight('Mars', 'Venus', 5000, ARRIVAL_DISTANCE, 1)).toBe('redirect')
  })

  it('камера уже у объекта и смотрит на него — полёта нет', () => {
    expect(decideFlight(null, 'Mars', ARRIVAL_DISTANCE * 1.005, ARRIVAL_DISTANCE, 1)).toBe('arrived')
  })

  it('у объекта, но смотрит в сторону — лететь (довернуть взгляд)', () => {
    expect(decideFlight(null, 'Mars', ARRIVAL_DISTANCE, ARRIVAL_DISTANCE, Math.cos((10 * Math.PI) / 180))).toBe('start')
  })

  it('смотрит на объект, но заметно дальше точки прилёта — лететь', () => {
    expect(decideFlight(null, 'Mars', ARRIVAL_DISTANCE * 1.2, ARRIVAL_DISTANCE, 1)).toBe('start')
  })
})

interface Rig {
  run: (name: string) => Promise<void>
  camera: { speed: number; setSpeed: ReturnType<typeof vi.fn> }
  notifications: SystemNotification[]
  renderCamera: PerspectiveCamera
  records: Map<string, ObservableRecord>
  controls: { enabled: boolean }
}

/** Тело радиуса 100 км → точка прилёта в 3 радиусах; позиции — в юнитах сцены фейка */
function rig(): Rig {
  const renderCamera = new PerspectiveCamera()
  const records = new Map<string, ObservableRecord>()
  const notifications: SystemNotification[] = []
  const camera = {
    speed: 10,
    setSpeed: vi.fn((value: number): void => {
      camera.speed = value
    })
  }
  const sceneObserver = {
    getData: (name: string): ObservableRecord | undefined => records.get(name),
    get cameraPosition(): Vector3 {
      return renderCamera.position.clone()
    }
  } as unknown as SceneObserver
  const sink: NotificationSink = { dispatch: (n: SystemNotification): void => void notifications.push(n) }
  const controls = { enabled: true }
  const command = (): CameraToObjectTransition =>
    new CameraToObjectTransition(
      sceneObserver,
      camera as unknown as CameraController,
      sink,
      { close: vi.fn() } as unknown as MenuController,
      renderCamera,
      controls as unknown as AstroControls
    )
  const run = async (name: string): Promise<void> => {
    const instance = command()

    instance.model = actor(name)
    await instance.handle()
  }

  return { run, camera, notifications, renderCamera, records, controls }
}

function actor(name: string): Actor {
  return {
    attributes: { name },
    category: { getAttribute: () => 'planet' },
    physicalObject: { getAttribute: () => 100 }
  } as unknown as Actor
}

/** Запись наблюдателя для тела в точке position относительно камеры */
function record(r: Rig, name: string, position: Vector3): void {
  r.records.set(name, { name, position, distance: position.distanceTo(r.renderCamera.position) })
}

/** Завершить полёт: позвать complete у шага пути (второй шаг таймлайна) */
function complete(timeline: FakeTimeline): void {
  ;(timeline.steps[1].complete as () => void)()
}

describe('CameraToObjectTransition — полёт к объекту идемпотентен', () => {
  beforeEach(() => {
    timelines.length = 0
    ;(CameraToObjectTransition as unknown as { active: unknown }).active = null
  })

  it('повторный клик по тому же объекту во время полёта второй анимации не запускает', async () => {
    const r = rig()
    record(r, 'Mars', new Vector3(0, 0, -1e6))

    await r.run('Mars')
    await r.run('Mars')

    expect(timelines).toHaveLength(1)
  })

  it('после прилёта скорость — та, что была до ПЕРВОГО клика, даже если в полёте кликнули другой объект', async () => {
    const r = rig()
    record(r, 'Mars', new Vector3(0, 0, -1e6))
    record(r, 'Venus', new Vector3(1e6, 0, 0))

    await r.run('Mars')
    // анимация разогнала камеру
    r.camera.speed = 123456
    await r.run('Venus')

    expect(timelines).toHaveLength(2)
    expect(timelines[0].pause).toHaveBeenCalled()

    complete(timelines[1])

    expect(r.camera.speed).toBe(10)
  })

  it('прерванный полёт свой complete не исполняет — управление и скорость возвращает только последний', async () => {
    const r = rig()
    record(r, 'Mars', new Vector3(0, 0, -1e6))
    record(r, 'Venus', new Vector3(1e6, 0, 0))

    await r.run('Mars')
    await r.run('Venus')
    r.camera.setSpeed.mockClear()

    complete(timelines[0])

    expect(r.camera.setSpeed).not.toHaveBeenCalled()
  })

  it('после завершения новый клик снова летит', async () => {
    const r = rig()
    record(r, 'Mars', new Vector3(0, 0, -1e6))

    await r.run('Mars')
    complete(timelines[0])
    await r.run('Mars')

    expect(timelines).toHaveLength(2)
  })

  it('камера уже у объекта и смотрит на него — полёта нет, только уведомление', async () => {
    const r = rig()
    // Точка прилёта команды — 3 радиуса тела (радиус фейка 100 км)
    const position = new Vector3(0, 0, -toThreeJSUnits(100) * 3)

    r.renderCamera.lookAt(position)
    record(r, 'Mars', position)

    await r.run('Mars')

    expect(timelines).toHaveLength(0)
    expect(r.notifications).toEqual([{ type: 'success', message: 'Target acquired: Mars' }])
  })

  it('первый кадр полёта не даёт скорости NaN', async () => {
    const r = rig()
    record(r, 'Mars', new Vector3(0, 0, -1e6))

    await r.run('Mars')

    const update = timelines[0].steps[1].update as (anim: unknown) => void
    update({ animations: [{ currentValue: '5' }] })

    expect(r.camera.setSpeed).not.toHaveBeenCalledWith(NaN)
  })

  it('скорость полёта — пройденный за кадр путь в км/с по своему замеру времени, общих часов нет', async () => {
    const r = rig()
    const now = vi.spyOn(performance, 'now')

    record(r, 'Mars', new Vector3(0, 0, -1e6))
    await r.run('Mars')

    const update = timelines[0].steps[1].update as (anim: unknown) => void

    now.mockReturnValue(1000)
    update({})
    // за 0.5 с камера прошла 500 км по диагонали — не по одной оси X
    r.renderCamera.position.set(toThreeJSUnits(300), 0, -toThreeJSUnits(400))
    now.mockReturnValue(1500)
    update({})

    expect(r.camera.setSpeed.mock.calls.at(-1)![0]).toBeCloseTo(1000, 6)
    now.mockRestore()
  })

  it('выход в меню посреди полёта: полёт остановлен, управление и скорость возвращены', async () => {
    const r = rig()
    record(r, 'Mars', new Vector3(0, 0, -1e6))

    await r.run('Mars')
    // begin анимации выключил управление, полёт разогнал камеру
    r.controls.enabled = false
    r.camera.speed = 999

    CameraToObjectTransition.cancelActive()

    expect(timelines[0].pause).toHaveBeenCalled()
    expect(r.controls.enabled).toBe(true)
    expect(r.camera.speed).toBe(10)

    // запоздалый complete отменённого полёта ничего не трогает
    r.camera.setSpeed.mockClear()
    complete(timelines[0])
    expect(r.camera.setSpeed).not.toHaveBeenCalled()

    // и следующий клик снова летит
    await r.run('Mars')
    expect(timelines).toHaveLength(2)
  })

  it('cancelActive без полёта ничего не делает', () => {
    expect(() => CameraToObjectTransition.cancelActive()).not.toThrow()
  })
})
