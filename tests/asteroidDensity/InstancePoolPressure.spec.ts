import { IcosahedronGeometry } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const GEOMETRY_STREAM = 0
const L0_MAX = 100

const makePool = (): InstancePool =>
  new InstancePool({ maxInstances: L0_MAX }, { maxInstances: 200 }, [new IcosahedronGeometry(1, 1)], 2.5)

// K=1 → ёмкость единственного Geometry-стрима = ceil((L0_MAX/1)·1.5)
const streamCapacity = Math.ceil(L0_MAX * 1.5)

describe('InstancePool: диагностика давления на пулы', () => {
  it('считает занятость по факту (не по high-water mark)', () => {
    const pool = makePool()
    const a = pool.allocate(GEOMETRY_STREAM, 40)!
    pool.allocate(GEOMETRY_STREAM, 30)
    pool.release(a) // дырка в начале буфера: hwm остаётся 70, занято 30

    const info = pool.getPressureInfo()
    expect(info.l0.used).toBe(30)
    expect(info.l0.capacity).toBe(streamCapacity)
    expect(info.l0.failures).toBe(0)
  })

  it('копит отказы allocate по стримам — молчаливое пропадание секторов становится видимым', () => {
    const pool = makePool()
    pool.allocate(GEOMETRY_STREAM, streamCapacity - 10) // почти заполнили стрим
    expect(pool.allocate(GEOMETRY_STREAM, 20)).toBeNull() // не влезает
    expect(pool.allocate(GEOMETRY_STREAM, 15)).toBeNull()
    expect(pool.allocate(pool.billboardStream, 20)).not.toBeNull() // другой стрим не затронут

    const info = pool.getPressureInfo()
    expect(info.l0.failures).toBe(2)
    expect(info.l1.failures).toBe(0)
    expect(info.totalFailures).toBe(2)
  })

  it('reset() обнуляет счётчики отказов вместе с пулами', () => {
    const pool = makePool()
    pool.allocate(GEOMETRY_STREAM, streamCapacity)
    pool.allocate(GEOMETRY_STREAM, 1)
    expect(pool.getPressureInfo().l0.failures).toBe(1)

    pool.reset()
    const info = pool.getPressureInfo()
    expect(info.l0.failures).toBe(0)
    expect(info.l0.used).toBe(0)
  })
})
