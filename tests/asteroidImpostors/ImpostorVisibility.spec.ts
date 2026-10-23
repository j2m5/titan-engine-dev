import { BoxGeometry, Group, InstancedBufferAttribute, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { poolSourceStreams } from '../helpers/ringSystemInternals'

function setup(ready = true) {
  const shape = new BoxGeometry(1, 1, 1)
  const pool = new InstancePool({ maxInstances: 16 }, { maxInstances: 16 }, { maxInstances: 16 }, [shape], [shape], 1, undefined, true, false, true)
  const mesh = pool.billboardMesh, stream = pool.billboardStream, u = pool.billboardMaterial.uniforms
  u.uImpostorReady.value = ready ? 1 : 0
  u.uImpostorPhysicalSize.value = 0.25
  u.uImpostorHalfExtents.value.fill(1)
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  const add = (x: number, y: number, z: number, target = stream) => {
    const allocation = pool.allocate(target, 1)!
    pool.writeMatrices(target, allocation.offset, new Float32Array(new Matrix4().makeTranslation(x, y, z).elements))
    pool.writeFade(target, allocation.offset, 1, 1)
    pool.writeDetailEnd(allocation, 12)
    pool.writeArchetypes(allocation, new Int32Array([0]))
    return allocation
  }
  const update = () => { camera.updateMatrixWorld(true); pool.commitUpdates(); pool.updateVisibility(camera) }
  return { pool, mesh, stream, u, camera, add, update }
}

describe('atlas impostor source-slot visibility', () => {
  it('omits offscreen atlas instances and restores the rear instance on a turn without changing allocation counts', () => {
    const { pool, mesh, camera, add, update } = setup()
    add(0, 0, -5); add(0, 0, 5); add(30, 0, -5)
    update()
    expect(mesh.count).toBe(1)
    expect(mesh.instanceMatrix.array[14]).toBe(-5)
    expect(pool.getPressureInfo().l1.used).toBe(3)
    camera.rotation.y = Math.PI; update()
    expect(mesh.count).toBe(1)
    expect(mesh.instanceMatrix.array[14]).toBe(5)
    camera.rotation.y = 0; update()
    expect(mesh.count).toBe(1)
    expect(mesh.instanceMatrix.array[14]).toBe(-5)
  })

  it('keeps matrices, origins, signed fade, cascade distance and atlas data paired through writes and slot reuse', () => {
    const { pool, mesh, stream, add, update } = setup()
    const hidden = add(30, 0, -5), visible = add(0, 0, -5)
    pool.writeFade(stream, visible.offset, 1, -0.4)
    pool.writeMaxDistance(stream, visible.offset, 1, 123)
    pool.writeDetailEnd(visible, 21); pool.writeArchetypes(visible, new Int32Array([1]))
    update()
    expect(mesh.count).toBe(1)
    expect(mesh.geometry.getAttribute('instanceFade').getX(0)).toBeCloseTo(-0.4)
    expect(mesh.geometry.getAttribute('instanceMaxDistance').getX(0)).toBe(123)
    expect(mesh.geometry.getAttribute('instanceDetailEnd').getX(0)).toBe(21)
    expect(mesh.geometry.getAttribute('instanceArchetype').getX(0)).toBe(1)
    pool.writeOrigins(stream, hidden.offset, 1, new Vector3(-30, 0, 0)); update()
    expect(mesh.count).toBe(2)
    expect(mesh.instanceMatrix.array[12]).toBe(30)
    expect(mesh.geometry.getAttribute('instanceOrigin').getX(0)).toBe(-30)
    pool.release(hidden)
    const reused = add(0, 2, -5)
    expect(reused.offset).toBe(hidden.offset)
    pool.writeOrigins(stream, reused.offset, 1, new Vector3())
    pool.writeFade(stream, visible.offset, 1, -0.8); update()
    expect(mesh.count).toBe(2)
    expect(mesh.instanceMatrix.array[13]).toBe(2)
    expect(mesh.geometry.getAttribute('instanceFade').getX(1)).toBeCloseTo(-0.8)
    expect(pool.getPressureInfo().l1.used).toBe(2)
  })

  it('avoids initial legacy copies and restores all source slots while atlas readiness is lost', () => {
    const { pool, mesh, stream, u, add, update } = setup(false)
    add(30, 0, -5); const visible = add(0, 0, -5)
    update()
    expect(mesh.count).toBe(2)
    expect(poolSourceStreams(pool)[stream].matrix).toBe(mesh.instanceMatrix)
    u.uImpostorReady.value = 1; update()
    expect(mesh.count).toBe(1)
    expect(poolSourceStreams(pool)[stream].matrix).not.toBe(mesh.instanceMatrix)
    u.uImpostorReady.value = 0; update()
    expect(mesh.count).toBe(2)
    expect(mesh.instanceMatrix.array[12]).toBe(30)
    pool.writeFade(stream, visible.offset, 1, -0.6); update()
    expect(mesh.geometry.getAttribute('instanceFade').getX(1)).toBeCloseTo(-0.6)
    u.uImpostorReady.value = 1; update()
    expect(mesh.count).toBe(1)
    expect(mesh.geometry.getAttribute('instanceFade').getX(0)).toBeCloseTo(-0.6)
  })

  it('retains per-instance legacy slots until their atlas detail boundary becomes valid', () => {
    const { pool, mesh, add, update } = setup()
    add(0, 0, -5); const legacy = add(30, 0, -5)
    add(-30, 0, -5)
    pool.writeDetailEnd(legacy, 0); update()
    expect(mesh.count).toBe(2)
    expect(mesh.instanceMatrix.array[28]).toBe(30)
    pool.writeDetailEnd(legacy, 12); update()
    expect(mesh.count).toBe(1)
  })

  it('restores full source data after atlas attributes are dropped, including subsequent matrix writes', () => {
    const { pool, mesh, stream, add, update } = setup()
    const hidden = add(30, 0, -5); add(0, 0, -5); update()
    expect(mesh.count).toBe(1)
    pool.dropImpostorAttributes(); update()
    expect(mesh.count).toBe(2)
    expect(mesh.geometry.getAttribute('instanceArchetype')).toBeUndefined()
    pool.writeMatrices(stream, hidden.offset, new Float32Array(new Matrix4().makeTranslation(40, 0, -5).elements)); update()
    expect(mesh.instanceMatrix.array[12]).toBe(40)
  })

  it('reuses original slots after reset and keeps renderer-owned buffer identities', () => {
    const { pool, mesh, add, update } = setup()
    const matrix = mesh.instanceMatrix, fade = mesh.geometry.getAttribute('instanceFade')
    add(30, 0, -5); add(0, 0, -5); update()
    expect(mesh.count).toBe(1)
    pool.reset(); update()
    expect(mesh.count).toBe(0)
    const next = add(0, 2, -5); update()
    expect(next.offset).toBe(0)
    expect(mesh.count).toBe(1)
    expect(mesh.instanceMatrix.array[13]).toBe(2)
    expect(mesh.instanceMatrix).toBe(matrix)
    expect(mesh.geometry.getAttribute('instanceFade')).toBe(fade)
  })

  it('uses the current slot half-extent and physical size, and preserves slots for invalid global size', () => {
    const { pool, mesh, u, add, update } = setup()
    const allocation = add(6.5, 0, -5)
    u.uImpostorHalfExtents.value[1] = 4
    update(); expect(mesh.count).toBe(0)
    pool.writeArchetypes(allocation, new Int32Array([1])); update()
    expect(mesh.count).toBe(1)
    u.uImpostorHalfExtents.value[1] = 0.25; update()
    expect(mesh.count).toBe(0)
    u.uImpostorPhysicalSize.value = 4; update()
    expect(mesh.count).toBe(1)
    for (const size of [0, NaN, Infinity, -1]) {
      u.uImpostorPhysicalSize.value = size; update()
      expect(mesh.count).toBe(1)
    }
  })

  it('keeps transformed bounds conservative under shear and reflection', () => {
    const { pool, mesh, stream, add, update } = setup()
    const sheared = add(5.9, 0, -5), reflected = add(8, 0, -5)
    pool.writeMatrices(stream, sheared.offset, new Float32Array(new Matrix4().set(5, 5, 5, 5.9, 0, 0.1, 0, 0, 0, 0, 0.1, -5, 0, 0, 0, 1).elements))
    pool.writeMatrices(stream, reflected.offset, new Float32Array(new Matrix4().makeScale(-30, 1, 1).setPosition(8, 0, -5).elements))
    update(); expect(mesh.count).toBe(2)
  })

  it('does not add near/far-plane rejection to reconstructed atlas depth', () => {
    const { mesh, add, update } = setup()
    add(0, 0, -0.01); add(0, 0, -200)
    update(); expect(mesh.count).toBe(2)
  })

  it('preserves world-space visibility when parent transform and source origins rebase together', () => {
    const { pool, mesh, stream, camera, add, update } = setup()
    const parent = new Group()
    parent.position.set(1e8, 2e8, -3e8); parent.scale.set(2, 3, 0.5); parent.rotation.y = 0.3; parent.add(mesh)
    parent.updateMatrixWorld(true); camera.position.copy(parent.position); camera.quaternion.copy(parent.quaternion)
    const visible = add(0, 0, -10), hidden = add(40, 0, -10)
    update(); expect(mesh.count).toBe(1)
    const shift = new Vector3(100, 20, 40)
    parent.position.add(shift.clone().multiply(parent.scale).applyQuaternion(parent.quaternion))
    for (const allocation of [visible, hidden]) pool.writeOrigins(stream, allocation.offset, 1, shift.clone().negate())
    update(); expect(mesh.count).toBe(1)
    expect(mesh.instanceMatrix.array[14]).toBe(-10)
  })

  it('uploads changed compact prefixes only, including multiple view updates before rendering', () => {
    const { pool, mesh, stream, camera, add, update } = setup()
    add(0, 0, 5); const visible = add(0, 0, -5); update()
    expect(mesh.count).toBe(1)
    const version = mesh.instanceMatrix.version, fade = mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute
    mesh.instanceMatrix.clearUpdateRanges(); fade.clearUpdateRanges(); update()
    expect(mesh.instanceMatrix.version).toBe(version)
    expect(mesh.instanceMatrix.updateRanges).toEqual([])
    pool.writeFade(stream, visible.offset, 1, 0.3); update()
    expect(fade.updateRanges).toEqual([{ start: 0, count: 1 }])
    camera.rotation.y = Math.PI; update(); camera.rotation.y = 0; update()
    expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }])
    expect(mesh.instanceMatrix.array[14]).toBe(-5)
  })

  it('keeps all three allocator domains independent while compacting each draw list', () => {
    const { pool, mesh, add, update } = setup()
    for (const stream of [0, pool.nearStreamBase, pool.billboardStream]) { add(0, 0, -5, stream); add(0, 0, 5, stream) }
    update()
    expect([pool.geometryMeshes[0].count, pool.nearMeshes[0].count, mesh.count]).toEqual([1, 1, 1])
    expect(pool.getActiveCount()).toEqual({ l0: 2, near: 2, l1: 2, total: 6 })
  })
})
