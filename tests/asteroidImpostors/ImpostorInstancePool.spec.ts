import { BoxGeometry, InstancedBufferAttribute } from 'three'
import { InstancePool, instancePoolCapacities } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

function makePool(enabled = true) {
  return new InstancePool({ maxInstances: 7 }, { maxInstances: 3 }, { maxInstances: 10 },
    [new BoxGeometry(), new BoxGeometry()], [new BoxGeometry(), new BoxGeometry()], 2.5, undefined, false, false, enabled)
}

describe('Буферы идентичности импосторов', () => {
  it('резерв учитывает округление каждого стрима и не добавляет draw calls', () => {
    expect(instancePoolCapacities(7, 3, 10, 2)).toEqual([6, 6, 3, 3, 10])
    const pool = makePool()
    expect(pool.getRenderObjects()).toHaveLength(5)
    expect(pool.getPressureInfo().l0.capacity).toBe(12)
    expect(pool.getPressureInfo().near.capacity).toBe(6)
    expect(pool.allocate(pool.billboardStream, 11)).toBeNull()
    expect(makePool(false).billboardMesh.geometry.hasAttribute('instanceArchetype')).toBe(false)
  })

  it('освобождение и reset стирают чужие ID/E/mix, а commit заливает только dirty ranges', () => {
    const pool = makePool(), allocation = pool.allocate(pool.billboardStream, 3)!
    pool.writeArchetypes(allocation, new Int32Array([1, 0, 1]))
    pool.writeDetailEnd(allocation, 80)
    pool.commitUpdates()
    const geometry = pool.billboardMesh.geometry
    const ids = geometry.getAttribute('instanceArchetype') as InstancedBufferAttribute
    const ends = geometry.getAttribute('instanceDetailEnd') as InstancedBufferAttribute
    expect(Array.from(ids.array).slice(0, 4)).toEqual([1, 0, 1, 0])
    expect(ids.updateRanges).toEqual([{ start: 0, count: 3 }])
    expect(ids.version).toBe(1)
    pool.release(allocation)
    const reused = pool.allocate(pool.billboardStream, 3)!
    expect(reused.offset).toBe(0)
    expect(Array.from(ids.array).slice(0, 3)).toEqual([0, 0, 0])
    expect(Array.from(ends.array).slice(0, 3)).toEqual([0, 0, 0])
    const near = pool.allocate(pool.nearStreamBase, 2)!
    pool.writeDetailEnd(near, 80); pool.writeDetailMix(near, 0.4)
    pool.reset()
    expect(Array.from(pool.nearMeshes[0].geometry.getAttribute('instanceDetailMix').array)).toEqual([0, 0, 0])
    expect(Array.from(pool.nearMeshes[0].geometry.getAttribute('instanceDetailEnd').array)).toEqual([0, 0, 0])
  })

  it('замена готовится без мутации и сохраняет все instance-атрибуты с диапазонами', () => {
    const pool = makePool(), source = new BoxGeometry(3, 4, 5), nearSource = new BoxGeometry(4, 5, 6)
    const allocation = pool.allocate(0, 2)!
    pool.writeDetailEnd(allocation, 70); pool.writeDetailMix(allocation, 0.3)
    const old = pool.geometryMeshes[0].geometry
    const update = pool.prepareArchetypeGeometry(0, source, nearSource)
    expect(pool.geometryMeshes[0].geometry).toBe(old)
    update.commit()
    const next = pool.geometryMeshes[0].geometry
    for (const name of ['instanceFade', 'instanceOrigin', 'instanceMaxDistance', 'instanceDetailEnd', 'instanceDetailMix']) {
      expect(next.getAttribute(name)).toBe(old.getAttribute(name))
    }
    expect((next.getAttribute('instanceDetailMix') as InstancedBufferAttribute).updateRanges).toEqual([{ start: 0, count: 2 }])
    expect(next.getAttribute('position')).toBe(source.getAttribute('position'))
    const dispose = vi.fn(); source.addEventListener('dispose', dispose)
    update.dispose(); update.dispose()
    expect(dispose).not.toHaveBeenCalled()
    const cancelled = pool.prepareArchetypeGeometry(0, new BoxGeometry(), new BoxGeometry())
    cancelled.dispose()
    expect(pool.geometryMeshes[0].geometry).toBe(next)
  })
})
