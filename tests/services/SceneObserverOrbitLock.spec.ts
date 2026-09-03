import { describe, expect, it } from 'vitest'
import { Scene, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { SceneObserver, type ObservableRecord } from '@/core/services/SceneObserver'
import { makeAstroControlsStub, makeBody } from './sceneObserverStubs'

/**
 * Пока камера вращается вокруг цели (зажата ПКМ), цель орбиты не должна
 * перескакивать на тело, оказавшееся ближе — луна, проплывающая между
 * камерой и Сатурном, иначе «перехватывала» орбиту. Ближайшее тело при этом
 * считается честно: стример и гейт карт высот живут по `ClosestChange`.
 */
function makeTwoBodyScene(): Scene {
  const scene = new Scene()

  scene.add(makeBody('planet', 'Saturn', new Vector3(10, 0, 0)))
  scene.add(makeBody('planet', 'Titan', new Vector3(100, 0, 0)))

  return scene
}

function lastTarget(controls: ReturnType<typeof makeAstroControlsStub>): Vector3 {
  const calls = (controls.setTarget as unknown as { mock: { calls: Vector3[][] } }).mock.calls

  return calls[calls.length - 1][0]
}

describe('SceneObserver: замок цели орбиты при зажатой ПКМ', () => {
  it('без орбиты цель следует за ближайшим телом', () => {
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeTwoBodyScene()

    controls.dispatch(new Vector3())
    expect(lastTarget(controls)).toEqual(new Vector3(10, 0, 0))

    controls.object.position.set(95, 0, 0)
    controls.dispatch(new Vector3())
    expect(lastTarget(controls)).toEqual(new Vector3(100, 0, 0))
  })

  it('при зажатой орбите цель остаётся прежней, хотя ближайшим стало другое тело', () => {
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeTwoBodyScene()

    controls.dispatch(new Vector3()) // цель — Сатурн
    controls.isOrbiting = true
    controls.object.position.set(95, 0, 0) // теперь ближе Титан
    controls.dispatch(new Vector3())

    expect(lastTarget(controls)).toEqual(new Vector3(10, 0, 0))
  })

  it('при зажатой орбите ClosestChange всё равно сообщает честно ближайшее тело', () => {
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeTwoBodyScene()

    const seen: string[] = []
    observer.subscribe('ClosestChange', (record: ObservableRecord): void => void seen.push(record.name))

    controls.dispatch(new Vector3())
    controls.isOrbiting = true
    controls.object.position.set(95, 0, 0)
    controls.dispatch(new Vector3())

    expect(seen).toEqual(['Saturn', 'Titan'])
  })

  it('удержанная цель следует за движением своего тела', () => {
    // Замок держит ТЕЛО, а не точку: при ускоренном времени планета за
    // несколько секунд драга заметно уезжает по орбите.
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()
    const scene = makeTwoBodyScene()

    observer.observable = controls
    observer.scene = scene

    controls.dispatch(new Vector3())
    controls.isOrbiting = true
    controls.object.position.set(95, 0, 0)
    scene.getObjectByName('Saturn')!.position.set(12, 0, 0)
    controls.dispatch(new Vector3())

    expect(lastTarget(controls)).toEqual(new Vector3(12, 0, 0))
  })

  it('после отпускания ПКМ цель переключается на ближайшее тело', () => {
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeTwoBodyScene()

    controls.dispatch(new Vector3())
    controls.isOrbiting = true
    controls.object.position.set(95, 0, 0)
    controls.dispatch(new Vector3())
    controls.isOrbiting = false
    controls.dispatch(new Vector3())

    expect(lastTarget(controls)).toEqual(new Vector3(100, 0, 0))
  })
})
