import { describe, it, expect, vi } from 'vitest'
import { Scene } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import { Scenarios } from '@/config/scenarios'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'

/**
 * Раньше накопленное между сценариями лежало в публичном массиве `deferred`,
 * и тест писал в него напрямую. Задача 5 убрала `deferred` вовсе, задача 2
 * (переезд на пути) сменила носитель ещё раз: `loaded`/`loadedAt`/`inFlight`/
 * `attempted` теперь ключуются путём, а не id актора. Инвариант («смена
 * сценария не копит состояние прошлого сценария») не изменился, изменился
 * только тип ключа, поэтому тест достаёт приватные поля через приведение
 * типа — единственный способ посмотреть на них снаружи класса.
 */
type StreamingInternals = {
  loaded: Set<string>
  loadedAt: Map<string, number>
  inFlight: Set<string>
  attempted: Set<string>
}

function streamingState(observer: ResourceObserver): StreamingInternals {
  return observer as unknown as StreamingInternals
}

function makeObserver(): ResourceObserver {
  const sceneObserver = { subscribe: vi.fn() } as unknown as SceneObserver

  return new ResourceObserver(
    sceneObserver,
    { load: vi.fn(() => Promise.resolve({ ok: false, texture: null, error: new Error('stub') })) } as unknown as TextureProvider,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    new Scene(),
    new TextureBudget(1024 ** 3)
  )
}

describe('ResourceObserver — смена сценария сбрасывает накопленное', () => {
  it('очищает учёт стриминга (loaded/loadedAt/inFlight/attempted)', () => {
    const observer = makeObserver()
    const state = streamingState(observer)

    observer.scenario = Scenarios[0]
    state.loaded.add('planets/a.jpg')
    state.loadedAt.set('planets/a.jpg', Date.now())
    state.inFlight.add('planets/b.jpg')
    state.attempted.add('planets/c.jpg')

    observer.scenario = Scenarios[1]

    expect(state.loaded.size).toBe(0)
    expect(state.loadedAt.size).toBe(0)
    expect(state.inFlight.size).toBe(0)
    expect(state.attempted.size).toBe(0)
  })

  it('не копит акторов в карте сценария', () => {
    const observer = makeObserver()

    observer.scenario = Scenarios[0]
    const first: number = observer.map.size

    observer.scenario = Scenarios[1]
    observer.scenario = Scenarios[0]

    expect(observer.map.size).toBe(first)
  })

  it('выход в меню очищает всё', () => {
    const observer = makeObserver()
    const state = streamingState(observer)

    observer.scenario = Scenarios[0]
    state.loaded.add('planets/a.jpg')

    observer.scenario = null

    expect(state.loaded.size).toBe(0)
    expect(observer.map.size).toBe(0)
  })
})
