import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, InstancedBufferAttribute, Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const setup = (layer: 'near' | 'l0') => {
  const geometry = new BoxGeometry(1, 1, 1)
  const pool = new InstancePool({ maxInstances: 16 }, { maxInstances: 16 }, { maxInstances: 16 }, [geometry], [geometry], 1, undefined, false, false, true)
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.updateMatrixWorld(true)
  const mesh = layer === 'near' ? pool.nearMeshes[0] : pool.geometryMeshes[0], stream = layer === 'near' ? pool.nearStreamBase : 0
  const add = (x: number, y: number, z: number) => {
    const allocation = pool.allocate(stream, 1)!
    pool.writeMatrices(stream, allocation.offset, new Float32Array(new Matrix4().makeTranslation(x, y, z).elements))
    pool.writeFade(stream, allocation.offset, 1, 1)
    return allocation
  }
  const update = () => { camera.updateMatrixWorld(true); pool.commitUpdates(); pool.updateVisibility(camera) }
  return { pool, camera, mesh, stream, add, update }
}

describe.each(['near', 'l0'] as const)('%s instance visibility', layer => {
  it('submits only visible slots and restores the others immediately on a camera turn', () => {
    const { pool, camera, mesh, add, update } = setup(layer)
    add(0, 0, -5); add(0, 0, 5); add(20, 0, -5)
    update()
    expect(mesh.count).toBe(1)
    expect(mesh.instanceMatrix.array[14]).toBe(-5)
    expect(pool.getPressureInfo()[layer].used).toBe(3)
    camera.rotation.y = Math.PI
    update()
    expect(mesh.count).toBe(1)
    expect(mesh.instanceMatrix.array[14]).toBe(5)
    camera.rotation.y = 0
    update()
    expect(mesh.instanceMatrix.array[14]).toBe(-5)
  })

  it('keeps source slots and all per-instance attributes paired through writes, release and reuse', () => {
    const { pool, mesh, stream, add, update } = setup(layer)
    const hidden = add(30, 0, -5), visible = add(0, 0, -5)
    pool.writeFade(stream, visible.offset, 1, -0.4)
    pool.writeDetailEnd(visible, 17); pool.writeDetailMix(visible, 0.7)
    update()
    expect(mesh.count).toBe(1)
    expect(mesh.geometry.getAttribute('instanceFade').getX(0)).toBeCloseTo(-0.4)
    expect(mesh.geometry.getAttribute('instanceDetailEnd').getX(0)).toBe(17)
    expect(mesh.geometry.getAttribute('instanceDetailMix').getX(0)).toBeCloseTo(0.7)
    pool.writeOrigins(stream, hidden.offset, 1, new Vector3(-30, 0, 0))
    pool.writeFade(stream, visible.offset, 1, -0.8)
    update()
    expect(mesh.count).toBe(2)
    expect(mesh.instanceMatrix.array[12]).toBe(30)
    expect(mesh.geometry.getAttribute('instanceOrigin').getX(0)).toBe(-30)
    expect(mesh.geometry.getAttribute('instanceFade').getX(1)).toBeCloseTo(-0.8)
    pool.release(hidden)
    update()
    expect(mesh.count).toBe(1)
    const reused = add(0, 1, -5)
    expect(reused.offset).toBe(hidden.offset)
    pool.writeOrigins(stream, reused.offset, 1, new Vector3())
    update()
    expect(mesh.count).toBe(2)
    expect(mesh.instanceMatrix.array[13]).toBe(1)
    expect(pool.getPressureInfo()[layer].used).toBe(2)
  })

  it('preserves visibility when floating origin and transformed parents move together', () => {
    const { pool, mesh, stream, camera, add, update } = setup(layer)
    const parent = new Group()
    parent.position.set(1e8, 2e8, -3e8); parent.scale.set(2, 3, 0.5); parent.rotation.y = 0.3
    parent.add(mesh); parent.updateMatrixWorld(true)
    camera.position.copy(parent.position); camera.quaternion.copy(parent.quaternion)
    const allocation = add(0, 0, -10)
    update()
    expect(mesh.count).toBe(1)
    const shift = new Vector3(100, 20, 40)
    parent.position.add(shift.clone().multiply(parent.scale).applyQuaternion(parent.quaternion))
    pool.writeOrigins(stream, allocation.offset, 1, shift.negate())
    update()
    expect(mesh.count).toBe(1)
  })

  it('refreshes off-center spin bounds after a geometry swap and position edits', () => {
    const { pool, mesh, add, update } = setup(layer)
    add(5, 0, -5)
    update()
    expect(mesh.count).toBe(0)
    const shape = new BoxGeometry(1, 1, 1).translate(-4, 0, 0)
    pool.replaceArchetypeGeometry(0, shape, shape)
    update()
    expect(mesh.count).toBe(1)
    const position = shape.getAttribute('position')
    for (let i = 0; i < position.count; i++) position.setXYZ(i, position.getX(i) + 4, position.getY(i), position.getZ(i))
    position.needsUpdate = true
    update()
    expect(mesh.count).toBe(0)
  })

  it('keeps geometry that can enter the view after residual displacement', () => {
    const { pool, mesh, add, update } = setup(layer)
    add(4.1, 0, -5)
    update()
    expect(mesh.count).toBe(0)
    pool.geometryMaterial.uniforms.uShapeAmpMin.value = -0.2
    update()
    expect(mesh.count).toBe(1)
  })

  it('checks all six planes and retains spheres whose centers are outside but whose bounds intersect', () => {
    const { pool, mesh, add } = setup(layer)
    const camera = new OrthographicCamera(-2, 2, 2, -2, 1, 9)
    camera.updateMatrixWorld(true)
    // Box radius sqrt(3)/2: offsets of 0.5 intersect; offsets of 1.5 do not.
    const centers = [
      [0, 0, -5], [2.5, 0, -5], [-2.5, 0, -5], [0, 2.5, -5], [0, -2.5, -5], [0, 0, -0.5], [0, 0, -9.5],
      [3.5, 0, -5], [-3.5, 0, -5], [0, 3.5, -5], [0, -3.5, -5], [0, 0, 0.5], [0, 0, -10.5]
    ]
    for (const [index, [x, y, z]] of centers.entries()) pool.writeDetailEnd(add(x, y, z), index + 10)
    pool.commitUpdates(); pool.updateVisibility(camera)
    expect(mesh.count).toBe(7)
    expect(Array.from({ length: mesh.count }, (_, i) => mesh.geometry.getAttribute('instanceDetailEnd').getX(i))).toEqual([10, 11, 12, 13, 14, 15, 16])
  })

  it('uses directional bounds for outside centers under shear, reflection and nonuniform scale', () => {
    const { pool, mesh, stream, add } = setup(layer)
    const camera = new OrthographicCamera(-2, 2, 2, -2, 1, 9)
    camera.updateMatrixWorld(true)
    // X support is sqrt(3)/2 * sqrt(8); Y support is sqrt(3)/4.
    for (const [index, [x, y]] of [[4, 0], [4.6, 0], [0, 2.3], [0, 2.6]].entries()) {
      const allocation = add(x, y, -5)
      const transform = new Matrix4().set(-2, 2, 0, x, 0, 0.5, 0, y, 0, 0, 1, -5, 0, 0, 0, 1)
      pool.writeMatrices(stream, allocation.offset, new Float32Array(transform.elements))
      pool.writeDetailEnd(allocation, 20 + index)
    }
    pool.commitUpdates(); pool.updateVisibility(camera)
    expect(mesh.count).toBe(2)
    expect(Array.from({ length: mesh.count }, (_, i) => mesh.geometry.getAttribute('instanceDetailEnd').getX(i))).toEqual([20, 22])
  })

  it('keeps zero-radius centers on planes and within the existing epsilon, then culls beyond it', () => {
    const { pool, mesh, add } = setup(layer)
    const point = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
    pool.replaceArchetypeGeometry(0, point, point)
    const camera = new OrthographicCamera(-2, 2, 2, -2, 1, 9)
    camera.updateMatrixWorld(true)
    // At y=0,z=-5 the side-plane epsilon is about 0.00008.
    const centers = [[0, 0, -5], [2, 0, -5], [-2, 0, -5], [0, 2, -5], [0, -2, -5], [0, 0, -1], [0, 0, -9],
      [2.000079, 0, -5], [-2.000079, 0, -5], [2.000081, 0, -5], [-2.000081, 0, -5]]
    for (const [index, [x, y, z]] of centers.entries()) pool.writeDetailEnd(add(x, y, z), index + 30)
    pool.commitUpdates(); pool.updateVisibility(camera)
    expect(mesh.count).toBe(9)
    expect(Array.from({ length: mesh.count }, (_, i) => mesh.geometry.getAttribute('instanceDetailEnd').getX(i))).toEqual([30, 31, 32, 33, 34, 35, 36, 37, 38])
  })

  it('does not upload unchanged attributes, bounds changed uploads, and survives context fallback/reset', () => {
    const { pool, mesh, stream, add, update } = setup(layer)
    const allocation = add(0, 0, -5)
    add(20, 0, -5)
    update()
    const matrixVersion = mesh.instanceMatrix.version, fade = mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute
    const fadeVersion = fade.version
    mesh.instanceMatrix.clearUpdateRanges(); fade.clearUpdateRanges()
    update()
    expect(mesh.instanceMatrix.version).toBe(matrixVersion)
    expect(fade.version).toBe(fadeVersion)
    expect(mesh.instanceMatrix.updateRanges).toEqual([])
    pool.writeFade(stream, allocation.offset, 1, 0.3)
    update()
    expect(mesh.instanceMatrix.version).toBe(matrixVersion)
    expect(fade.updateRanges).toEqual([{ start: 0, count: 1 }])
    expect(fade.getX(0)).toBeCloseTo(0.3)
    pool.dropImpostorAttributes()
    update()
    expect(mesh.geometry.getAttribute('instanceDetailMix')).toBeUndefined()
    expect(mesh.count).toBe(1)
    pool.reset(); update()
    expect(mesh.count).toBe(0)
    add(0, 0, -7); update()
    expect(mesh.count).toBe(1)
    expect(mesh.instanceMatrix.array[14]).toBe(-7)
  })
})

it('keeps allocator counts independent while culling both geometry tiers and retaining billboards', () => {
  const { pool, add, update } = setup('l0')
  add(0, 0, -5); add(0, 0, 5); add(20, 0, -5)
  for (const [stream, z] of [[pool.nearStreamBase, -5], [pool.nearStreamBase, 5], [pool.billboardStream, 5]]) {
    const allocation = pool.allocate(stream, 1)!
    pool.writeMatrices(stream, allocation.offset, new Float32Array(new Matrix4().makeTranslation(0, 0, z).elements))
    pool.writeFade(stream, allocation.offset, 1, 1)
  }
  update()
  expect(pool.geometryMeshes[0].count).toBe(1)
  expect(pool.nearMeshes[0].count).toBe(1)
  expect(pool.billboardMesh.count).toBe(1)
  expect(pool.getActiveCount()).toEqual({ l0: 3, near: 2, l1: 1, total: 6 })
})
