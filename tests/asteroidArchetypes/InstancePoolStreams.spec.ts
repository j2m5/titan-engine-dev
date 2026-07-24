import { BoxGeometry, Float32BufferAttribute } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const K = 4
const makeGeometries = (): BoxGeometry[] =>
  Array.from({ length: K }, () => {
    const g = new BoxGeometry(1, 1, 1)
    // Атрибут-«запекание» произвольного имени (аналог surfaceData) — проверка,
    // что пул копирует ВСЕ атрибуты источника, а не только position/normal.
    const count = g.getAttribute('position').count
    g.setAttribute('surfaceData', new Float32BufferAttribute(new Float32Array(count * 4), 4))
    return g
  })

describe('InstancePool: K инстанс-стримов (архетипы)', () => {
  it('K геометрий → K+1 рендер-объектов; все Geometry-меши делят ОДИН InstancedAsteroidMaterial', () => {
    const pool = new InstancePool(
      { maxInstances: 400 },
      { maxInstances: 300 },
      { maxInstances: 800 },
      makeGeometries(),
      makeGeometries(),
      2.5
    )

    expect(pool.geometryMeshes.length).toBe(K)
    expect(pool.geometryStreamCount).toBe(K)

    for (const mesh of pool.geometryMeshes) {
      expect(mesh.material).toBe(pool.geometryMaterial)
    }
    // Общий материал — не K независимых экземпляров (иначе K+1 материалов, 2K драуколлов)
    expect(new Set(pool.geometryMeshes.map((m) => m.material)).size).toBe(1)
  })

  it('ёмкость каждого Geometry-стрима = ceil((maxInstances/K)·1.5) — страховка от локальной фрагментации', () => {
    const maxInstances = 401 // не делится на K нацело — проверяет именно ceil
    const pool = new InstancePool(
      { maxInstances },
      { maxInstances: 300 },
      { maxInstances: 100 },
      makeGeometries(),
      makeGeometries(),
      2.5
    )
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
    const pool = new InstancePool(
      { maxInstances: 400 },
      { maxInstances: 300 },
      { maxInstances: 800 },
      makeGeometries(),
      makeGeometries(),
      2.5
    )

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

  it('репро ревью: разделяемые геометрии архетипов не текут между пулами — instanceFade изолирован', () => {
    // Один и тот же массив геометрий имитирует кэш ArchetypeLibrary, который
    // отдаёт ОДНИ И ТЕ ЖЕ BufferGeometry всем системам одного профиля колец.
    const sharedGeometries = makeGeometries()

    const poolA = new InstancePool(
      { maxInstances: 400 },
      { maxInstances: 300 },
      { maxInstances: 800 },
      sharedGeometries,
      makeGeometries(),
      2.5
    )
    const allocA = poolA.allocate(0, 10)!
    poolA.writeFade(0, allocA.offset, allocA.count, 1.0)
    poolA.commitUpdates()

    const poolB = new InstancePool(
      { maxInstances: 400 },
      { maxInstances: 300 },
      { maxInstances: 800 },
      sharedGeometries,
      makeGeometries(),
      2.5
    )

    // Создание poolB (второго пула поверх ТЕХ ЖЕ геометрий) не стёрло fade poolA
    const fadeA = poolA.geometryMeshes[0].geometry.getAttribute('instanceFade').array as Float32Array
    expect(fadeA[allocA.offset]).toBeCloseTo(1.0)

    // Атрибуты fade у poolA и poolB — разные объекты (собственные буферы стрима)
    const fadeAttrA = poolA.geometryMeshes[0].geometry.getAttribute('instanceFade')
    const fadeAttrB = poolB.geometryMeshes[0].geometry.getAttribute('instanceFade')
    expect(fadeAttrA).not.toBe(fadeAttrB)

    // poolB стартует с чистым fade — не унаследовал состояние poolA
    const fadeB = fadeAttrB.array as Float32Array
    expect(fadeB[allocA.offset]).toBe(0)
  })

  it('копирует ВСЕ атрибуты источника по ссылке (position/normal/surfaceData), не только position/normal', () => {
    const sources = makeGeometries()
    const pool = new InstancePool(
      { maxInstances: 400 },
      { maxInstances: 300 },
      { maxInstances: 800 },
      sources,
      makeGeometries(),
      2.5
    )

    for (let k = 0; k < K; k++) {
      const meshGeometry = pool.geometryMeshes[k].geometry
      for (const name of Object.keys(sources[k].attributes)) {
        expect(meshGeometry.getAttribute(name)).toBe(sources[k].getAttribute(name))
      }
      // instanceFade — собственный атрибут пула, не унаследован от источника
      expect(sources[k].getAttribute('instanceFade')).toBeUndefined()
      expect(meshGeometry.getAttribute('instanceFade')).toBeDefined()
    }
  })

  it('отказ аллокации в одном стриме не портит остальные', () => {
    const pool = new InstancePool(
      { maxInstances: 40 },
      { maxInstances: 30 },
      { maxInstances: 80 },
      makeGeometries(),
      makeGeometries(),
      2.5
    )
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

  describe('Near-тир (2K+1 стримов)', () => {
    it('конструктор бросает Error, если длины l0Geometries и nearGeometries не совпадают (обе обязаны быть K)', () => {
      const shortNear = Array.from({ length: K - 1 }, () => new BoxGeometry(1, 1, 1))
      expect(
        () =>
          new InstancePool(
            { maxInstances: 400 },
            { maxInstances: 300 },
            { maxInstances: 800 },
            makeGeometries(),
            shortNear,
            2.5
          )
      ).toThrow()
    })

    it('K геометрий l0+near → 2K+1 рендер-объектов; Near-меши делят ОДИН материал с Geometry', () => {
      const pool = new InstancePool(
        { maxInstances: 400 },
        { maxInstances: 300 },
        { maxInstances: 800 },
        makeGeometries(),
        makeGeometries(),
        2.5
      )

      expect(pool.getRenderObjects().length).toBe(2 * K + 1)
      expect(pool.nearMeshes.length).toBe(K)

      for (const mesh of pool.nearMeshes) {
        expect(mesh.material).toBe(pool.geometryMaterial)
      }
      const allMaterials = new Set([...pool.geometryMeshes, ...pool.nearMeshes, pool.billboardMesh].map((m) => m.material))
      // Geometry+Near делят один материал, billboard — свой → 2 уникальных материала на 2K+1 мешей
      expect(allMaterials.size).toBe(2)

      for (let k = 0; k < K; k++) {
        expect(pool.nearMeshes[k].name).toBe(`AsteroidPool_Near_${k}`)
      }
    })

    it('раскладка стримов: 0..K-1 = Geometry, K..2K-1 = Near (nearStreamBase), 2K = billboard', () => {
      const pool = new InstancePool(
        { maxInstances: 400 },
        { maxInstances: 300 },
        { maxInstances: 800 },
        makeGeometries(),
        makeGeometries(),
        2.5
      )

      expect(pool.nearStreamBase).toBe(K)
      expect(pool.billboardStream).toBe(2 * K)

      const nearAlloc = pool.allocate(pool.nearStreamBase, 5)!
      expect(nearAlloc.stream).toBe(pool.nearStreamBase)

      const lastNearAlloc = pool.allocate(pool.nearStreamBase + K - 1, 3)!
      expect(lastNearAlloc.stream).toBe(2 * K - 1)

      const billboardAlloc = pool.allocate(pool.billboardStream, 3)!
      expect(billboardAlloc.stream).toBe(2 * K)
    })

    it('ёмкость каждого Near-стрима = ceil((nearConfig.maxInstances/K)·1.5) — своя формула, своя конфигурация', () => {
      const nearMax = 301 // не делится на K нацело — проверяет именно ceil
      const pool = new InstancePool(
        { maxInstances: 999 }, // l0Config заведомо другой — near не должен зависеть от него
        { maxInstances: nearMax },
        { maxInstances: 100 },
        makeGeometries(),
        makeGeometries(),
        2.5
      )
      const expectedCapacity = Math.ceil((nearMax / K) * 1.5)

      for (const mesh of pool.nearMeshes) {
        const attr = mesh.geometry.getAttribute('instanceFade')
        expect(attr.count).toBe(expectedCapacity)
      }

      for (let k = 0; k < K; k++) {
        const stream = pool.nearStreamBase + k
        expect(pool.allocate(stream, expectedCapacity)).not.toBeNull()
        expect(pool.allocate(stream, 1)).toBeNull() // near-стрим k заполнен под завязку
      }
    })

    it('Near-обёртки копируют ВСЕ атрибуты источника по ссылке и получают собственный instanceFade', () => {
      const nearSources = makeGeometries()
      const pool = new InstancePool(
        { maxInstances: 400 },
        { maxInstances: 300 },
        { maxInstances: 800 },
        makeGeometries(),
        nearSources,
        2.5
      )

      for (let k = 0; k < K; k++) {
        const meshGeometry = pool.nearMeshes[k].geometry
        for (const name of Object.keys(nearSources[k].attributes)) {
          expect(meshGeometry.getAttribute(name)).toBe(nearSources[k].getAttribute(name))
        }
        expect(nearSources[k].getAttribute('instanceFade')).toBeUndefined()
        expect(meshGeometry.getAttribute('instanceFade')).toBeDefined()
      }
    })

    it('изоляция fade Near-обёрток: разделяемые near-геометрии не текут между пулами (тот же паттерн, что у Geometry)', () => {
      const sharedNear = makeGeometries()

      const poolA = new InstancePool(
        { maxInstances: 400 },
        { maxInstances: 400 },
        { maxInstances: 800 },
        makeGeometries(),
        sharedNear,
        2.5
      )
      const allocA = poolA.allocate(poolA.nearStreamBase, 10)!
      poolA.writeFade(poolA.nearStreamBase, allocA.offset, allocA.count, 1.0)
      poolA.commitUpdates()

      const poolB = new InstancePool(
        { maxInstances: 400 },
        { maxInstances: 400 },
        { maxInstances: 800 },
        makeGeometries(),
        sharedNear,
        2.5
      )

      // Создание poolB поверх ТЕХ ЖЕ near-геометрий не стёрло fade poolA
      const fadeA = poolA.nearMeshes[0].geometry.getAttribute('instanceFade').array as Float32Array
      expect(fadeA[allocA.offset]).toBeCloseTo(1.0)

      const fadeAttrA = poolA.nearMeshes[0].geometry.getAttribute('instanceFade')
      const fadeAttrB = poolB.nearMeshes[0].geometry.getAttribute('instanceFade')
      expect(fadeAttrA).not.toBe(fadeAttrB)

      const fadeB = fadeAttrB.array as Float32Array
      expect(fadeB[allocA.offset]).toBe(0)
    })

    it('getActiveCount/getPressureInfo дают три корзины l0/near/l1, near независим от l0', () => {
      const pool = new InstancePool(
        { maxInstances: 40 },
        { maxInstances: 40 },
        { maxInstances: 80 },
        makeGeometries(),
        makeGeometries(),
        2.5
      )
      const perStreamCapacity = Math.ceil((40 / K) * 1.5)

      pool.allocate(0, perStreamCapacity)
      pool.allocate(1, 3)
      pool.allocate(pool.nearStreamBase, 5)
      pool.commitUpdates()

      const active = pool.getActiveCount()
      expect(active.l0).toBe(perStreamCapacity + 3)
      expect(active.near).toBe(5)
      expect(active.l1).toBe(0)
      expect(active.total).toBe(active.l0 + active.near + active.l1)

      const info = pool.getPressureInfo()
      expect(info).toEqual({
        l0: { used: perStreamCapacity + 3, capacity: perStreamCapacity * K, failures: 0 },
        near: { used: 5, capacity: perStreamCapacity * K, failures: 0 },
        l1: { used: 0, capacity: 80, failures: 0 },
        totalFailures: 0
      })
    })

    it('отказ аллокации в Near-стриме не портит соседние Near/Geometry/billboard стримы', () => {
      const pool = new InstancePool(
        { maxInstances: 40 },
        { maxInstances: 40 },
        { maxInstances: 80 },
        makeGeometries(),
        makeGeometries(),
        2.5
      )
      const perStreamCapacity = Math.ceil((40 / K) * 1.5)
      const nearStream0 = pool.nearStreamBase

      pool.allocate(nearStream0, perStreamCapacity)
      expect(pool.allocate(nearStream0, 1)).toBeNull() // near-стрим 0 переполнен

      expect(pool.allocate(nearStream0 + 1, perStreamCapacity)).not.toBeNull()
      expect(pool.allocate(0, 5)).not.toBeNull()
      expect(pool.allocate(pool.billboardStream, 10)).not.toBeNull()

      const info = pool.getPressureInfo()
      expect(info.near.failures).toBe(1)
      expect(info.l0.failures).toBe(0)
      expect(info.l1.failures).toBe(0)
    })
  })
})
