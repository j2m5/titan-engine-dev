import { describe, it, expect } from 'vitest'
import { Object3D, PerspectiveCamera, Vector3 } from 'three'
import { SpaceScale } from '@/core/constants'
import { AtmosphereRegistry, type AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { captureAtmosphereFrame } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import { SceneCloudBackend, assertSceneCloudProjection } from '@/core/clouds/takram/SceneCloudBackend'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'

function entry(id: number, distanceKm: number, ready = true): AtmosphereEntry {
  const object = new Object3D()
  object.position.set(0, 0, -distanceKm * SpaceScale)
  object.updateMatrixWorld()
  return {
    actorId: id,
    name: String(id),
    object,
    ready,
    generation: 0,
    config: { topRadius: 6400 } as AtmosphereEntry['config'],
    lut: {} as AtmosphereEntry['lut']
  }
}
describe('shared atmosphere frame', () => {
  it('rejects a nonfinite pinned shadow far-frustum before updating, with no arbitrary far/near ratio cutoff', () => {
    expect(() => assertSceneCloudProjection(new PerspectiveCamera(45, 1, 1e-6, 1.5e8))).not.toThrow()
    expect(() => assertSceneCloudProjection(new PerspectiveCamera(45, 1, 1e-8, 1e9))).toThrow(/projection/)
    const singular = new PerspectiveCamera()
    singular.projectionMatrixInverse.elements.fill(0)
    expect(() => assertSceneCloudProjection(singular)).toThrow(/projection/)
  })
  it('refuses a pending LUT before constructing or borrowing GPU resources', () => {
    expect(
      () =>
        new SceneCloudBackend(
          {} as CloudFrame,
          entry(1, 10000, false),
          {} as ReturnType<typeof prepareCloudSource>,
          'terrestrial',
          'low'
        )
    ).toThrow(/ready/)
  })
  it('selects only ready slots and freezes their far-to-near geometry and generation', () => {
    const camera = new PerspectiveCamera()
    camera.updateMatrixWorld()
    const registry = new AtmosphereRegistry()
    const far = entry(1, 50000),
      near = entry(2, 10000)
    registry.register(near)
    registry.register(entry(3, 9000, false))
    registry.register(far)
    const snapshot = captureAtmosphereFrame(camera, registry, 42)
    expect(snapshot.serial).toBe(42)
    expect(snapshot.slots.map((s) => s.entry.actorId)).toEqual([1, 2])
    expect(snapshot.slots.map((s) => s.index)).toEqual([0, 1])
    expect(snapshot.slots[0].centerKm.distanceTo(new Vector3(0, 0, -50000))).toBeLessThan(1e-8)
    const generation = snapshot.slots[0].generation
    far.object.position.x = 100
    registry.markPending(1)
    expect(snapshot.slots[0].generation).toBe(generation)
    expect(snapshot.slots[0].generation).not.toBe(far.generation)
    expect(snapshot.slots[0].centerKm.x).toBe(0)
    expect(Object.isFrozen(snapshot.slots)).toBe(true)
  })
  it('uses the bounded main atmosphere choice even when a cloud body is dropped', () => {
    const registry = new AtmosphereRegistry()
    for (let i = 1; i <= 4; i++) registry.register(entry(i, 10000 * i))
    const snapshot = captureAtmosphereFrame(new PerspectiveCamera(), registry, 1)
    expect(snapshot.slots.map((s) => s.entry.actorId)).toEqual([3, 2, 1])
    registry.unregister(1)
    expect(captureAtmosphereFrame(new PerspectiveCamera(), registry, 2).slots.map((s) => s.entry.actorId)).toEqual([
      4, 3, 2
    ])
  })
})
