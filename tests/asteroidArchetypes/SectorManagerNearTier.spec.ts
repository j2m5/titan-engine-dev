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
 * Ортографическая камера с УЗКИМ view-projection, нацеленная точно на мировую
 * позицию сектора (сверху вниз, halfExtent << реальный boundingRadius сетки).
 * Собственный центр сектора всегда попадает в любой (даже крошечный) бокс,
 * поэтому сектор проходит intersectsSphere тривиально — а вот его угловые
 * соседи (центр дальше, чем halfExtent) исключаются. Это ИЗОЛИРУЕТ ровно один
 * сектор от frustum-culling независимо от того, какую дистанцию мы подаём в
 * cameraAngle/cameraRadius (эти аргументы влияют только на diстанционную
 * лестницу LOD и grid-range запрос, а не на frustum).
 */
function buildTightViewProjection(centerX: number, centerZ: number, halfExtent: number): Matrix4 {
  const camera = new OrthographicCamera(-halfExtent, halfExtent, halfExtent, -halfExtent, 0.1, 1000)
  camera.position.set(centerX, 500, centerZ)
  camera.up.set(0, 0, -1)
  camera.lookAt(centerX, 0, centerZ)
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

// Тонкая полоса на большом радиусе (arcSpan ≈ cellSize при R=500, ОДИН слой:
// width == cellSize) — тайл получается ~квадратным (radialSpan ≈ arcSpan),
// поэтому boundingRadius (полудиагональ, ~3.5) < расстояния между соседними
// центрами по углу (~5, хорда arcSpan) — что и делает изоляцию через узкий
// frustum геометрически возможной (см. buildTightViewProjection).
const gridConfig: SectorGridConfig = {
  innerRadius: 497.5,
  outerRadius: 502.5,
  cellSize: 5,
  ringId: 555,
  densityPerUnit: 1.24
}

const thresholds: LODThresholds = {
  l0MaxDistance: 40,
  l1MaxDistance: 80,
  nearEnterDistance: 3,
  nearExitDistance: 8
}

const identity = new Matrix4()

function buildScene(): { grid: SectorGrid; generator: AsteroidGenerator; pool: InstancePool; manager: SectorManager } {
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
  return { grid, generator, pool, manager }
}

describe('SectorManager: Near-LOD по ближайшей точке сектора с гистерезисом', () => {
  it('distClosest ≤ nearEnterDistance → сектор активируется в Near (ненулевые аллокации в Near-стримах)', () => {
    const { grid, pool, manager } = buildScene()
    const info0 = grid.getSectorInfo(0, 0)
    const vpMatrix = buildTightViewProjection(info0.centerX, info0.centerZ, 1.0)
    const expectedGroupCounts = computeGroupCounts(info0.seed, info0.instanceCount, K)

    // Камера ровно в центре сектора: distClosest = max(0, 0 - boundingRadius) = 0.
    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)

    expect(manager.activeCount).toBe(1)
    pool.commitUpdates()

    const nearCounts = pool.nearMeshes.map((m) => m.count)
    const geometryCounts = pool.geometryMeshes.map((m) => m.count)

    expect(nearCounts).toEqual(expectedGroupCounts)
    expect(geometryCounts).toEqual(new Array<number>(K).fill(0))
    expect(pool.getPressureInfo().near.used).toBe(info0.instanceCount)
    expect(pool.getPressureInfo().l0.used).toBe(0)
  })

  it('гистерезис: distClosest осциллирует между enter и exit → сектор не флипает (остаётся Near, outgoing не возникает)', () => {
    const { grid, pool, manager } = buildScene()
    const info0 = grid.getSectorInfo(0, 0)
    const vpMatrix = buildTightViewProjection(info0.centerX, info0.centerZ, 1.0)
    const br = info0.boundingRadius

    // Активировать в Near.
    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)
    expect(pool.getPressureInfo().near.used).toBe(info0.instanceCount)

    // distClosest = 5 и 7 — ОБА между enter(3) и exit(8). Стейтлес-порог по
    // enter выгнал бы сектор из Near на КАЖДОЙ из этих итераций (5 > 3, 7 > 3),
    // и он бы пересчитался по лестнице l0/l1 (Geometry, т.к. dist <= l0MaxDistance) —
    // осциллируя между Near и Geometry каждый кадр. Гистерезис (порог exit=8
    // для уже-Near сектора) должен удержать его в Near все итерации.
    const offsetA = br + 5
    const offsetB = br + 7

    // Малая delta — если бы произошёл flip, недоигранный outgoing/incoming
    // остался бы виден в pressure (частичная аллокация Geometry-стрима).
    for (let i = 0; i < 6; i++) {
      const offset = i % 2 === 0 ? offsetA : offsetB
      manager.update(info0.centerAngle, info0.centerRadius + offset, vpMatrix, identity, 0.001)
    }

    const pressure = pool.getPressureInfo()
    expect(pressure.l0.used).toBe(0) // Geometry-стрим ни разу не тронут — flip'а не было.
    expect(pressure.l0.failures).toBe(0)
    expect(pressure.near.used).toBe(info0.instanceCount) // одна и та же аллокация Near, без пересоздания.
    expect(manager.activeCount).toBe(1)
  })

  it('distClosest > nearExitDistance → кросс-фейд Near→Geometry, архетип по стримам k совпадает', () => {
    const { grid, pool, manager } = buildScene()
    const info0 = grid.getSectorInfo(0, 0)
    const vpMatrix = buildTightViewProjection(info0.centerX, info0.centerZ, 1.0)
    const br = info0.boundingRadius
    const expectedGroupCounts = computeGroupCounts(info0.seed, info0.instanceCount, K)

    // 1) Активируем Near, большая delta мгновенно осаживает fade к 1.
    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)
    pool.commitUpdates()
    expect(pool.nearMeshes.map((m) => m.count)).toEqual(expectedGroupCounts)

    // 2) Уводим камеру так, что distClosest(15) > nearExitDistance(8), но
    // dist по-прежнему <= l0MaxDistance(40) — переход Near → Geometry (не Billboard).
    const offsetExit = br + 15
    manager.update(info0.centerAngle, info0.centerRadius + offsetExit, vpMatrix, identity, 1.0)
    pool.commitUpdates()

    expect(manager.activeCount).toBe(1)
    const pressure = pool.getPressureInfo()
    expect(pressure.near.used).toBe(0) // старый Near-тир полностью погас и освобождён

    // Раскладка по архетипам (k) в Geometry — ТА ЖЕ, что была в Near (тот же
    // seed/instanceCount/multiplier=1.0 → те же группы archetypeForInstance).
    expect(pool.geometryMeshes.map((m) => m.count)).toEqual(expectedGroupCounts)
  })

  it('конструктор: nearEnterDistance >= nearExitDistance → Error', () => {
    const { grid, generator, pool } = buildScene()
    const badThresholds: LODThresholds = {
      ...thresholds,
      nearEnterDistance: 8,
      nearExitDistance: 8
    }

    expect(() => new SectorManager(grid, generator, pool, badThresholds)).toThrow()
  })
})
