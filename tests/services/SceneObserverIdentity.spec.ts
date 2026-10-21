import { afterEach, describe, expect, it, vi } from 'vitest'
import { Object3D, Scene, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { Actor } from '@/core/models/Actor'
import { SceneObserver } from '@/core/services/SceneObserver'
import { makeAstroControlsStub } from './sceneObserverStubs'

const observers: SceneObserver[] = []
afterEach(() => { for (const observer of observers.splice(0)) observer.dispose() })

function body(actorId: number, name: string, x: number): Object3D {
  const object = new Object3D()
  object.model = new Actor({ id: actorId, name })
  object.userData.type = 'planet'
  object.position.x = x
  return object
}

function stand(...bodies: Object3D[]) {
  const observer = new SceneObserver()
  observers.push(observer)
  const controls = makeAstroControlsStub()
  const scene = new Scene()
  scene.add(...bodies)
  observer.observable = controls
  observer.scene = scene
  const update = (): void => controls.dispatch(new Vector3())
  return { observer, controls, scene, update }
}

describe('SceneObserver actor identity', () => {
  it('keeps distinct distances and nearest/farthest records for same-name actors', () => {
    const { observer, controls, update } = stand(body(1, 'Twin', 10), body(2, 'Twin', 100))
    update()
    expect(observer.data.size).toBe(2)
    expect(observer.getData(1)).toMatchObject({ actorId: 1, name: 'Twin', distance: 10 })
    expect(observer.getData(2)).toMatchObject({ actorId: 2, name: 'Twin', distance: 100 })
    expect(observer.calculateClosestObject()?.actorId).toBe(1)
    expect(observer.calculateFarthestObjects(2).map((record) => record.actorId)).toEqual([2, 1])
    expect(controls.setTarget).toHaveBeenLastCalledWith(new Vector3(10, 0, 0))
  })

  it('holds the selected actor during orbit drag despite a nearer namesake', () => {
    const first = body(1, 'Twin', 10)
    const second = body(2, 'Twin', 100)
    // Put the nearer body last to make the initial old name-keyed choice correct.
    const { controls, observer, update } = stand(second, first)
    update()
    controls.isOrbiting = true
    controls.object.position.x = 95
    first.position.x = 12
    update()
    expect(controls.setTarget).toHaveBeenLastCalledWith(new Vector3(12, 0, 0))
    expect(observer.calculateClosestObject()?.actorId).toBe(2)
  })

  it('keeps a renamed orbit target moving and does not retain its old label', () => {
    const target = body(1, 'Before', 10)
    const { controls, observer, update } = stand(target, body(2, 'Other', 100))
    update()
    controls.isOrbiting = true
    controls.object.position.x = 95
    target.model!.setAttribute('name', 'After')
    target.position.x = 12
    update()
    expect(controls.setTarget).toHaveBeenLastCalledWith(new Vector3(12, 0, 0))
    expect([...observer.data.values()].map((record) => record.name)).toEqual(['After', 'Other'])
  })

  it('observes one actor once across surfaces and ignores meshes without an actor identity', () => {
    const helper = new Object3D()
    helper.userData.type = 'planet'
    const { observer, update } = stand(body(1, 'Body', 10), body(1, 'Body', 10), helper)
    update()
    expect(observer.data.size).toBe(1)
    expect(observer.calculateClosestObject()).toMatchObject({ actorId: 1, name: 'Body' })
  })
})

describe('SceneObserver observation lifecycle', () => {
  it('drops a detached orbit target even when the objects snapshot has not refreshed', () => {
    const removed = body(1, 'Removed', 10)
    const { observer, controls, scene, update } = stand(removed, body(2, 'Remaining', 100))
    update()
    controls.isOrbiting = true
    scene.remove(removed)
    expect(observer.objects).toContain(removed)
    update()
    expect([...observer.data.keys()]).toEqual([2])
    expect(observer.objects).not.toContain(removed)
    expect(controls.setTarget).toHaveBeenLastCalledWith(new Vector3(100, 0, 0))
  })

  it('refreshes records immediately without emitting another closest event', () => {
    const removed = body(1, 'Removed', 10)
    const { observer, scene, update } = stand(removed, body(2, 'Remaining', 100))
    update()
    const listener = vi.fn()
    observer.subscribe('ClosestChange', listener)
    scene.remove(removed)
    observer.refreshObservableObjects()
    expect([...observer.data.keys()]).toEqual([2])
    expect(listener).not.toHaveBeenCalled()
  })

  it('replaces old scene records and resets orbit identity even if the new scene reuses an ID', () => {
    const { observer, controls, update } = stand(body(1, 'Old', 10), body(3, 'Gone', 30))
    update()
    controls.isOrbiting = true
    const next = new Scene()
    next.add(body(1, 'Reused', 100), body(2, 'Nearest', 1))
    observer.scene = next
    expect([...observer.data.keys()]).toEqual([1, 2])
    update()
    expect(controls.setTarget).toHaveBeenLastCalledWith(new Vector3(1, 0, 0))
  })

  it('announces an empty scene and releases the old orbit lock before bodies return', () => {
    const removed = body(1, 'Removed', 10)
    const { observer, controls, scene, update } = stand(removed)
    update()
    controls.isOrbiting = true
    const listener = vi.fn()
    observer.subscribe('ClosestChange', listener)
    scene.remove(removed)
    update()
    expect(observer.calculateClosestObject()).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(null)
    scene.add(body(1, 'Reused', 100), body(2, 'Nearest', 1))
    observer.refreshObservableObjects()
    update()
    expect(controls.setTarget).toHaveBeenLastCalledWith(new Vector3(1, 0, 0))
  })

  it('replaces a surface under the same ID during a listener without recursive events', () => {
    const old = body(1, 'Body', 10)
    const replacement = body(1, 'Body', 20)
    const { observer, scene, update } = stand(old)
    const listener = vi.fn(() => {
      scene.remove(old)
      scene.add(replacement)
      observer.refreshObservableObjects()
    })
    observer.subscribe('ClosestChange', listener)
    update()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(observer.getData(1)?.distance).toBe(20)
  })

  it('can refresh a scene before controls have been installed', () => {
    const observer = new SceneObserver()
    observers.push(observer)
    const scene = new Scene()
    scene.add(body(1, 'Body', 10))
    observer.scene = scene
    expect(() => observer.refreshObservableObjects()).not.toThrow()
    expect(observer.data.size).toBe(0)
  })
})
