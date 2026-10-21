import { describe, it, expect } from 'vitest'
import { Color, Object3D, PerspectiveCamera, Vector2, Vector3 } from 'three'
import { SpaceScale } from '@/core/constants'
import { captureCloudFrame, cloudLayerAltitude, decodeSceneCloudDepth } from '@/core/clouds/scene/CloudFrame'
import { CloudRegistry, type CloudBodyEntry } from '@/core/services/CloudRegistry'

export function body(): CloudBodyEntry {
  const object = new Object3D()
  return {
    actorId: 7,
    object,
    getSurface: () => object,
    datumRadiusMeters: 6371000,
    descriptor: { state: 'unconfigured', volume: null, far: null, qualityProfile: 'terrestrial', issues: [] },
    resourcePaths: new Map(),
    lightColor: new Color(0.4, 0.5, 0.6),
    lambert: 0.8
  }
}
describe('cloud frame', () => {
  it('uses datum rather than terrain floor for altitude', () => {
    expect(cloudLayerAltitude(6371000, 6360000, 4000)).toBe(15000)
  })
  it('decodes original scene log distance into ray metres', () => {
    const factor = Math.log2(1e9 + 1)
    const depth = Math.log2(3.25 + 1) / factor
    expect(decodeSceneCloudDepth(depth, factor, 1000 / SpaceScale, 1)).toBeCloseTo((3.25 * 1000) / SpaceScale, 5)
    expect(decodeSceneCloudDepth(depth, factor, 1000 / SpaceScale, 0.5)).toBeCloseTo((6.5 * 1000) / SpaceScale, 5)
    expect(decodeSceneCloudDepth(1, factor, 1000 / SpaceScale, 1)).toBe(Infinity)
    for (const d of [-1, 1.01, NaN, Infinity]) expect(decodeSceneCloudDepth(d, factor, 1, 1)).toBe(Infinity)
    for (const f of [0, -1, Infinity]) expect(decodeSceneCloudDepth(depth, f, 1, 1)).toBe(Infinity)
    expect(decodeSceneCloudDepth(depth, factor, 1, 0)).toBe(Infinity)
  })
  it('subtracts large centres on CPU and snapshots the corrected camera without mutating it', () => {
    const entry = body()
    entry.object.position.set(1e9, -1e9, 1e9)
    const camera = new PerspectiveCamera(55, 1.7, 1e-8, 1e9)
    camera.setViewOffset(1000, 800, 100, 50, 700, 600)
    camera.position.copy(entry.object.position).add(new Vector3(SpaceScale / 1000, 0, 0))
    camera.updateMatrixWorld()
    const original = camera.matrixWorld.clone()
    const projection = camera.projectionMatrix.clone()
    const frame = captureCloudFrame(entry, camera, new Vector2(100, 80), 42, 0.02)!
    expect(frame.camera.position.x).toBe((camera.position.clone().sub(entry.object.position).x * 1000) / SpaceScale)
    expect(frame.camera.projectionMatrix.equals(projection)).toBe(false)
    expect(frame.camera.view).toEqual(camera.view)
    expect(frame.camera.far).toBe((1e9 * 1000) / SpaceScale)
    expect(camera.far).toBe(1e9)
    expect(camera.matrixWorld.equals(original)).toBe(true)
    expect(camera.projectionMatrix.equals(projection)).toBe(true)
    camera.position.x += 1
    expect(frame.camera.position.x).toBeLessThan(2)
    expect(frame.serial).toBe(42)
    expect(frame.sunDirection.distanceTo(entry.object.position.clone().negate().normalize())).toBeLessThan(1e-12)
  })
  it('keeps replacement registrations when an old owner unregisters', () => {
    const registry = new CloudRegistry()
    const remove = registry.register(body())
    const replacement = body()
    registry.register(replacement)
    remove()
    expect(registry.entries()).toEqual([replacement])
    registry.clear()
    expect(registry.entries()).toEqual([])
  })
})
