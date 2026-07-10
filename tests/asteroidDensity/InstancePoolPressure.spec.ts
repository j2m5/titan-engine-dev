import { InstancePool, LODLevel } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const makePool = (): InstancePool => new InstancePool({ maxInstances: 100 }, { maxInstances: 200 }, 1, 1)

describe('InstancePool: диагностика давления на пулы', () => {
  it('считает занятость по факту (не по high-water mark)', () => {
    const pool = makePool()
    const a = pool.allocate(LODLevel.Geometry, 40)!
    pool.allocate(LODLevel.Geometry, 30)
    pool.release(a) // дырка в начале буфера: hwm остаётся 70, занято 30

    const info = pool.getPressureInfo()
    expect(info.l0.used).toBe(30)
    expect(info.l0.capacity).toBe(100)
    expect(info.l0.failures).toBe(0)
  })

  it('копит отказы allocate по LOD — молчаливое пропадание секторов становится видимым', () => {
    const pool = makePool()
    pool.allocate(LODLevel.Geometry, 90)
    expect(pool.allocate(LODLevel.Geometry, 20)).toBeNull() // не влезает
    expect(pool.allocate(LODLevel.Geometry, 15)).toBeNull()
    expect(pool.allocate(LODLevel.Billboard, 20)).not.toBeNull() // другой пул не затронут

    const info = pool.getPressureInfo()
    expect(info.l0.failures).toBe(2)
    expect(info.l1.failures).toBe(0)
    expect(info.totalFailures).toBe(2)
  })

  it('reset() обнуляет счётчики отказов вместе с пулами', () => {
    const pool = makePool()
    pool.allocate(LODLevel.Geometry, 100)
    pool.allocate(LODLevel.Geometry, 1)
    expect(pool.getPressureInfo().l0.failures).toBe(1)

    pool.reset()
    const info = pool.getPressureInfo()
    expect(info.l0.failures).toBe(0)
    expect(info.l0.used).toBe(0)
  })
})
