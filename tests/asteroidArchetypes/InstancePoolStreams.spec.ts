import { BoxGeometry } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const K = 4
const makeGeometries = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))

describe('InstancePool: K инстанс-стримов (архетипы)', () => {
  it('K геометрий → K+1 рендер-объектов; все Geometry-меши делят ОДИН InstancedAsteroidMaterial', () => {
    const pool = new InstancePool({ maxInstances: 400 }, { maxInstances: 800 }, makeGeometries(), 2.5)

    expect(pool.getRenderObjects().length).toBe(K + 1)
    expect(pool.geometryMeshes.length).toBe(K)
    expect(pool.geometryStreamCount).toBe(K)
    expect(pool.billboardStream).toBe(K)

    for (const mesh of pool.geometryMeshes) {
      expect(mesh.material).toBe(pool.geometryMaterial)
    }
    // Общий материал — не K независимых экземпляров (иначе K+1 материалов, 2K драуколлов)
    expect(new Set(pool.geometryMeshes.map((m) => m.material)).size).toBe(1)
  })

  it('ёмкость каждого Geometry-стрима = ceil((maxInstances/K)·1.5) — страховка от локальной фрагментации', () => {
    const maxInstances = 401 // не делится на K нацело — проверяет именно ceil
    const pool = new InstancePool({ maxInstances }, { maxInstances: 100 }, makeGeometries(), 2.5)
    const expectedCapacity = Math.ceil((maxInstances / K) * 1.5)

    for (const mesh of pool.geometryMeshes) {
      const attr = mesh.geometry.getAttribute('instanceFade')
      expect(attr.count).toBe(expectedCapacity)
    }

    for (let k = 0; k < K; k++) {
      expect(pool.allocate(k, expectedCapacity)).not.toBeNull()
      expect(pool.allocate(k, 1)).toBeNull() // стрим k заполнен под завязку
    }
  })

  it('allocate/release/writeMatrices/writeFade независимы по стримам', () => {
    const pool = new InstancePool({ maxInstances: 400 }, { maxInstances: 800 }, makeGeometries(), 2.5)

    const a0 = pool.allocate(0, 10)!
    const a1 = pool.allocate(1, 20)!
    expect(a0.stream).toBe(0)
    expect(a1.stream).toBe(1)

    pool.writeFade(0, a0.offset, a0.count, 1.0)
    pool.writeFade(1, a1.offset, a1.count, 0.5)
    pool.commitUpdates()

    expect(pool.getActiveCount().l0).toBe(30) // сумма hwm по всем K Geometry-стримам (10+20)

    pool.release(a0)
    // Освобождение стрима 0 не трогает занятость стрима 1
    expect(pool.getPressureInfo().l0.used).toBe(20)

    const attr1 = pool.geometryMeshes[1].geometry.getAttribute('instanceFade').array as Float32Array
    expect(attr1[a1.offset]).toBeCloseTo(0.5)
  })

  it('getPressureInfo суммирует по Geometry-стримам, внешняя форма ответа прежняя ({l0,l1,totalFailures})', () => {
    const pool = new InstancePool({ maxInstances: 40 }, { maxInstances: 80 }, makeGeometries(), 2.5)
    const perStreamCapacity = Math.ceil((40 / K) * 1.5)

    pool.allocate(0, perStreamCapacity)
    pool.allocate(1, 3)

    const info = pool.getPressureInfo()
    expect(info).toEqual({
      l0: { used: perStreamCapacity + 3, capacity: perStreamCapacity * K, failures: 0 },
      l1: { used: 0, capacity: 80, failures: 0 },
      totalFailures: 0
    })
  })

  it('отказ аллокации в одном стриме не портит остальные', () => {
    const pool = new InstancePool({ maxInstances: 40 }, { maxInstances: 80 }, makeGeometries(), 2.5)
    const perStreamCapacity = Math.ceil((40 / K) * 1.5)

    pool.allocate(0, perStreamCapacity)
    expect(pool.allocate(0, 1)).toBeNull() // стрим 0 переполнен

    // Соседние стримы полностью работоспособны
    expect(pool.allocate(1, perStreamCapacity)).not.toBeNull()
    expect(pool.allocate(2, 5)).not.toBeNull()
    expect(pool.allocate(pool.billboardStream, 10)).not.toBeNull()

    const info = pool.getPressureInfo()
    expect(info.l0.failures).toBe(1)
    expect(info.l1.failures).toBe(0)
  })
})
