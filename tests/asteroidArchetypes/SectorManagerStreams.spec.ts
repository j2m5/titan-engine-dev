import { BoxGeometry, Matrix4, OrthographicCamera } from 'three'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import {
  AsteroidGenerator,
  archetypeForInstance
} from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const K = 3

/**
 * Ортографическая камера, чей view-projection покрывает ВЕСЬ полигон сетки
 * (extent должен быть заметно больше outerRadius кольца) — исключает frustum
 * culling из уравнения этих тестов, оставляя только LOD/дистанционную логику.
 */
function buildAllVisibleViewProjection(extent: number): Matrix4 {
  const camera = new OrthographicCamera(-extent, extent, extent, -extent, 0.1, extent * 4)
  camera.position.set(0, 0, extent * 2)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
}

/** Та же раскладка, что использует производственный код — для сравнения в тестах. */
function computeGroupCounts(seed: number, count: number, archetypeCount: number): number[] {
  const counts = new Array<number>(archetypeCount).fill(0)
  for (let i = 0; i < count; i++) {
    counts[archetypeForInstance(seed, i, archetypeCount)]++
  }
  return counts
}

const makeGeometries = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))

// Один слой (innerRadius=0..outerRadius=100), 6 угловых секторов — сектор (0,0)
// стабильно даёт ~31 инстанс (area * densityPerUnit), достаточно для K=3.
const gridConfig: SectorGridConfig = {
  innerRadius: 0,
  outerRadius: 100,
  cellSize: 100,
  ringId: 777,
  densityPerUnit: 0.006
}

// Пороги подобраны так, чтобы: сосед по сетке (~50 units) не проходил ни в
// Geometry, ни в Billboard диапазон — desiredSectors содержит РОВНО сектор (0,0).
// nearEnter/nearExitDistance намеренно отрицательные: эти тесты проверяют
// исключительно Geometry/Billboard-раскладку (K-стримы, кросс-фейд), Near-тир
// вне их скоупа. distClosest всегда >= 0 (см. SectorManager.update), поэтому
// отрицательный порог входа гарантирует, что Near никогда не активируется —
// то же поведение, что было при отсутствующих полях (сравнение с undefined
// всегда false) до появления Near-тира в LODThresholds.
const thresholds: LODThresholds = {
  l0MaxDistance: 5,
  l1MaxDistance: 10,
  nearEnterDistance: -1,
  nearExitDistance: -0.5
}

const identity = new Matrix4()
const vpMatrix = buildAllVisibleViewProjection(1000)

describe('SectorManager: раскладка активных секторов по K стримам архетипов', () => {
  it('активация Geometry-сектора создаёт ≤K суб-аллокаций, сумма их count = instanceCount', () => {
    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 100 },
      makeGeometries(),
      makeGeometries(),
      2.5
    )
    const manager = new SectorManager(grid, generator, pool, thresholds)

    const info0 = grid.getSectorInfo(0, 0)
    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)

    expect(manager.activeCount).toBe(1)

    pool.commitUpdates()
    const perStreamCounts = pool.geometryMeshes.map((m) => m.count)
    const nonEmptyStreams = perStreamCounts.filter((c) => c > 0).length

    expect(nonEmptyStreams).toBeLessThanOrEqual(K)
    expect(perStreamCounts.reduce((a, b) => a + b, 0)).toBe(info0.instanceCount)
    expect(pool.getPressureInfo().l0.used).toBe(info0.instanceCount)

    // Раскладка реально идёт по K архетипам (не всё оседает в одном стриме):
    // per-stream count должен побитово совпадать с archetypeForInstance-группировкой.
    const expectedGroupCounts = computeGroupCounts(info0.seed, info0.instanceCount, K)
    expect(perStreamCounts).toEqual(expectedGroupCounts)
    expect(nonEmptyStreams).toBeGreaterThan(1) // сектор из ~31 инстансов должен затронуть >1 стрима
  })

  it('отказ аллокации в одном из K стримов → полный откат: 0 живых аллокаций сверх предзаполненного, failures растёт, сектор не активен', () => {
    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const l0Cap = 300
    const perStreamCapacity = Math.ceil((l0Cap / K) * 1.5)
    const pool = new InstancePool(
      { maxInstances: l0Cap },
      { maxInstances: 300 },
      { maxInstances: 100 },
      makeGeometries(),
      makeGeometries(),
      2.5
    )
    const manager = new SectorManager(grid, generator, pool, thresholds)

    const info0 = grid.getSectorInfo(0, 0)
    const groupCounts = computeGroupCounts(info0.seed, info0.instanceCount, K)
    // Целенаправленно НЕ стрим 0: старая (до Task 5) реализация адресовала
    // Geometry-путь исключительно стримом 0, так что конфликт именно там мог
    // случайно "спасти" тест независимо от того, реализована ли раскладка по
    // K стримам. Стрим >0 дискриминирует это явно.
    let targetStream = 1
    for (let k = 2; k < K; k++) {
      if (groupCounts[k] > groupCounts[targetStream]) targetStream = k
    }
    const need = groupCounts[targetStream]
    expect(need).toBeGreaterThan(1) // нужен запас минимум в 1 инстанс, иначе тест не показателен

    // Предзаполняем ИМЕННО целевой (самый крупный) стрим так, чтобы группе не
    // хватило РОВНО одного места — гарантированный отказ на этом стриме.
    const prefill = perStreamCapacity - (need - 1)
    expect(pool.allocate(targetStream, prefill)).not.toBeNull()

    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)

    expect(manager.activeCount).toBe(0)
    const pressure = pool.getPressureInfo()
    // Ничего сверх предзаполненного не выжило — все суб-аллокации попытки откачены.
    expect(pressure.l0.used).toBe(prefill)
    expect(pressure.l0.failures).toBeGreaterThan(0)
  })

  it('кросс-фейд Geometry → Billboard: outgoing-массив суб-аллокаций полностью освобождается по завершении перехода', () => {
    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 100 },
      makeGeometries(),
      makeGeometries(),
      2.5
    )
    const manager = new SectorManager(grid, generator, pool, thresholds)

    const info0 = grid.getSectorInfo(0, 0)

    // 1) Активируем как Geometry, большая delta мгновенно осаживает fade к 1.
    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)
    expect(pool.getPressureInfo().l0.used).toBe(info0.instanceCount)

    // 2) Отодвигаем камеру радиально за l0MaxDistance, но в пределах l1MaxDistance:
    // сектор переключается на Billboard, старый Geometry-тир уходит в outgoing и
    // (с той же большой delta) успевает полностью догаснуть и освободиться.
    manager.update(info0.centerAngle, info0.centerRadius + 7, vpMatrix, identity, 1.0)

    expect(manager.activeCount).toBe(1)
    const pressure = pool.getPressureInfo()
    expect(pressure.l0.used).toBe(0) // ВСЕ суб-аллокации старого Geometry-тира освобождены
    // Тиры держат ОДИНАКОВОЕ число камней — см. lodDensityMultiplier: расхождение
    // означало бы импосторы без геометрического двойника (тесты паритета тиров).
    expect(pressure.l1.used).toBe(info0.instanceCount)
  })

  it('deactivateAll освобождает всё, включая недоигравший outgoing переход (used = 0 везде)', () => {
    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 100 },
      makeGeometries(),
      makeGeometries(),
      2.5
    )
    const manager = new SectorManager(grid, generator, pool, thresholds)

    const info0 = grid.getSectorInfo(0, 0)

    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)
    // Малая delta — переход к Billboard НЕ успевает завершиться, outgoing ещё жив.
    manager.update(info0.centerAngle, info0.centerRadius + 7, vpMatrix, identity, 0.01)

    manager.deactivateAll()

    expect(manager.activeCount).toBe(0)
    const pressure = pool.getPressureInfo()
    expect(pressure.l0.used).toBe(0)
    expect(pressure.l1.used).toBe(0)
  })
})
