import { BoxGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera } from 'three'
import { InstanceVisibility } from '@/core/renderables/DetailedRingStreamingSystem/InstanceVisibility'
import { IMPOSTOR_SLOT_CAPACITY } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'

const suffix = Array.from({ length: 60 }, (_, i) => i + 20)
const mixed = [1, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, ...suffix]
const regrouped = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 16, 17, 18, 19, ...suffix]
const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose() })

function setup(mode: 'geometry' | 'impostor') {
  const capacity = 80, geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial()
  const packedBacking = new Uint16Array(capacity * 4 + 8).fill(60000)
  const packed = packedBacking.subarray(4, -4)
  for (let i = 0; i < packed.length; i++) packed[i] = 100 + i
  geometry.setAttribute('packed', new InstancedBufferAttribute(packed, 4, true))
  geometry.setAttribute('scalar', new InstancedBufferAttribute(Float32Array.from({ length: capacity }, (_, i) => i ? -i - 0.25 : -0), 1))
  geometry.setAttribute('vector', new InstancedBufferAttribute(Float32Array.from({ length: capacity * 3 }, (_, i) => i + 0.5), 3))
  geometry.setAttribute('instanceOrigin', new InstancedBufferAttribute(new Float32Array(capacity * 3), 3))
  geometry.setAttribute('instanceArchetype', new InstancedBufferAttribute(new Float32Array(capacity), 1))
  geometry.setAttribute('instanceDetailEnd', new InstancedBufferAttribute(new Float32Array(capacity).fill(12), 1))
  const mesh = new InstancedMesh(geometry, material, capacity)
  for (let slot = 0; slot < capacity; slot++) mesh.setMatrixAt(slot, new Matrix4().makeTranslation(100, 0, -10 - slot * 0.01))
  const visibility = new InstanceVisibility(mesh), camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.updateMatrixWorld(true)
  const halfExtents = new Float32Array(IMPOSTOR_SLOT_CAPACITY).fill(1)
  const pairs = [
    { source: visibility.matrix, target: mesh.instanceMatrix },
    ...Array.from(visibility.attributes, ([name, source]) => ({ source, target: geometry.getAttribute(name) as InstancedBufferAttribute }))
  ]
  const select = (slots: readonly number[]) => {
    for (let slot = 0; slot < capacity; slot++) visibility.matrix.array[slot * 16 + 12] = slots.includes(slot) ? 0 : 100
    visibility.matrix.needsUpdate = true
  }
  const update = () => mode === 'geometry'
    ? visibility.update(camera, capacity, 0)
    : visibility.updateImpostors(camera, capacity, halfExtents, 0.25)
  const check = (slots: readonly number[], action = update) => {
    // Literal visible IDs are the independent reference; no internal slot/run data.
    const expected = pairs.map(({ source, target }) => {
      const result = target.array.slice()
      result.set(slots.flatMap(slot => Array.from(source.array.slice(slot * source.itemSize, (slot + 1) * source.itemSize))))
      return result
    })
    const sources = pairs.map(({ source }) => source.array.slice())
    action()
    expect(mesh.count).toBe(slots.length)
    pairs.forEach(({ source, target }, i) => {
      expect(new Uint8Array(target.array.buffer, target.array.byteOffset, target.array.byteLength)).toEqual(new Uint8Array(expected[i].buffer))
      expect(new Uint8Array(source.array.buffer)).toEqual(new Uint8Array(sources[i].buffer))
      expect(target.updateRanges).toEqual(slots.length ? [{ start: 0, count: slots.length * source.itemSize }] : [])
    })
    expect(packedBacking.slice(0, 4)).toEqual(new Uint16Array(4).fill(60000))
    expect(packedBacking.slice(-4)).toEqual(new Uint16Array(4).fill(60000))
  }
  cleanup.push(() => { mesh.dispose(); geometry.dispose(); material.dispose() })
  return { visibility, mesh, geometry, pairs, select, update, check }
}

describe.each(['geometry', 'impostor'] as const)('%s attribute compaction', mode => {
  it('preserves bytes, attribute pairing and unused tails across mixed runs ending at capacity', () => {
    const f = setup(mode), matrix = f.mesh.instanceMatrix
    const attributes = { ...f.geometry.attributes }
    f.select(mixed)
    f.check(mixed)
    expect(f.mesh.instanceMatrix).toBe(matrix)
    for (const [name, attribute] of Object.entries(attributes)) expect(f.geometry.getAttribute(name)).toBe(attribute)
    expect(f.geometry.getAttribute('packed').normalized).toBe(true)
  })

  it('refreshes regrouped slots and only the attribute whose source version changes afterwards', () => {
    const f = setup(mode)
    f.select(mixed); f.check(mixed)
    const beforeRegroup = f.pairs.map(({ target }) => target.version)
    f.select(regrouped); f.check(regrouped)
    f.pairs.forEach(({ target }, i) => expect(target.version).toBe(beforeRegroup[i] + 1))
    const beforeStable = f.pairs.map(({ target }) => target.version)
    for (const { target } of f.pairs) target.clearUpdateRanges()
    f.update()
    f.pairs.forEach(({ target }, i) => {
      expect(target.version).toBe(beforeStable[i])
      expect(target.updateRanges).toEqual([])
    })
    const source = f.visibility.attributes.get('scalar')!, target = f.geometry.getAttribute('scalar') as InstancedBufferAttribute
    source.setX(7, 123.5); source.setX(50, -225.25); source.needsUpdate = true
    f.update()
    expect(Array.from(target.array).slice(0, 16)).toEqual([-0, -1.25, -2.25, -3.25, -5.25, -6.25, 123.5, -8.25, -10.25, -11.25, -12.25, -13.25, -16.25, -17.25, -18.25, -19.25])
    expect(target.getX(46)).toBe(-225.25)
    f.pairs.forEach(({ target: attribute }, i) => {
      expect(attribute.version).toBe(beforeStable[i] + (attribute === target ? 1 : 0))
      expect(attribute.updateRanges).toEqual(attribute === target ? [{ start: 0, count: 76 }] : [])
    })
  })

  it('handles zero, one and all slots and restores the complete source after culling', () => {
    const f = setup(mode), all = Array.from({ length: 80 }, (_, i) => i)
    f.select(mixed); f.check(mixed)
    const beforeEmpty = f.pairs.map(({ target }) => target.version)
    f.select([]); f.check([])
    f.pairs.forEach(({ target }, i) => expect(target.version).toBe(beforeEmpty[i]))
    f.select([79]); f.check([79])
    f.check(all, () => f.visibility.restore(80))
    f.check([79])
    f.select(all); f.check(all)
  })
})
