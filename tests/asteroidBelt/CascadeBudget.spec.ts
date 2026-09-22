import { describe, it, expect } from 'vitest'
import { BoxGeometry, OrthographicCamera, PerspectiveCamera, Matrix4 } from 'three'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'

const K = 3
const makeGeometries = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))

/** Сетка с заведомо густыми секторами — доля пула упирается быстро */
const makeManager = (capacityShare: number, activationBudget: number): SectorManager => {
  const grid = new SectorGrid({
    innerRadius: 35,
    outerRadius: 70,
    cellSize: 1,
    ringId: 1,
    densityPerUnit: 2000,
    heightExtent: 1
  })
  const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.3, maxScale: 1.6, profile: 'stony' })
  const pool = new InstancePool(
    { maxInstances: 20000 },
    { maxInstances: 5000 },
    { maxInstances: 20000 },
    makeGeometries(),
    makeGeometries(),
    2.5
  )

  return new SectorManager(
    grid,
    generator,
    pool,
    { l0MaxDistance: 3, l1MaxDistance: 6, nearEnterDistance: 1.2, nearExitDistance: 1.6 },
    null,
    capacityShare,
    activationBudget
  )
}

const frame = (manager: SectorManager): void => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e6)
  camera.position.set(52, 0, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  const viewProj = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  manager.update(0, 52, 0, viewProj, new Matrix4(), 0.016)
}

describe('SectorManager: доля пула и бюджет активации', () => {
  it('за кадр активируется не больше бюджета', () => {
    const manager = makeManager(Infinity, 3)
    frame(manager)
    expect(manager.activeCount).toBeLessThanOrEqual(3)
  })

  it('упёршись в долю, каскад перестаёт активировать и считает отказы', () => {
    const manager = makeManager(500, 64)
    for (let i = 0; i < 10; i++) frame(manager)

    expect(manager.usedInstances).toBeLessThanOrEqual(500)
    expect(manager.getDebugInfo().capacityFailures).toBeGreaterThan(0)
  })

  it('без доли ограничение не действует, отказов по доле нет', () => {
    const manager = makeManager(Infinity, 64)
    for (let i = 0; i < 10; i++) frame(manager)

    expect(manager.getDebugInfo().capacityFailures).toBe(0)
    expect(manager.usedInstances).toBeGreaterThan(0)
  })
})

describe('SectorManager: usedInstances переживает смену тира и кросс-фейд', () => {
  // Один сектор на всю сетку, всегда в кадре — тот же приём, что в тестах
  // раскладки по стримам (SectorManagerStreams.spec.ts).
  const K = 3
  const gridConfig: SectorGridConfig = {
    innerRadius: 0,
    outerRadius: 100,
    cellSize: 100,
    ringId: 777,
    densityPerUnit: 0.006
  }
  const thresholds: LODThresholds = {
    l0MaxDistance: 5,
    l1MaxDistance: 10,
    nearEnterDistance: -1,
    nearExitDistance: -0.5
  }
  const identity = new Matrix4()

  function buildAllVisibleViewProjection(extent: number): Matrix4 {
    const camera = new OrthographicCamera(-extent, extent, extent, -extent, 0.1, extent * 4)
    camera.position.set(0, 0, extent * 2)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
  }

  it('Geometry → Billboard → Geometry: usedInstances равен instanceCount на каждом устоявшемся кадре', () => {
    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 100 },
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      2.5
    )
    const manager = new SectorManager(grid, generator, pool, thresholds, null, Infinity, 4)
    const vpMatrix = buildAllVisibleViewProjection(1000)
    const info0 = grid.getSectorInfo(0, 0, 0)

    // Активация Geometry. Большая delta мгновенно осаживает fade к 1.
    manager.update(info0.centerAngle, info0.centerRadius, 0, vpMatrix, identity, 1.0)
    expect(manager.usedInstances).toBe(info0.instanceCount)

    // Отъезд за l0MaxDistance → смена тира на Billboard, кросс-фейд успевает
    // завершиться за тот же большой delta — outgoing Geometry-тир освобождён.
    manager.update(info0.centerAngle, info0.centerRadius + 7, 0, vpMatrix, identity, 1.0)
    expect(manager.usedInstances).toBe(info0.instanceCount)

    // Возврат камеры → смена тира обратно на Geometry, кросс-фейд снова завершён.
    manager.update(info0.centerAngle, info0.centerRadius, 0, vpMatrix, identity, 1.0)
    expect(manager.usedInstances).toBe(info0.instanceCount)
  })

  it('на время кросс-фейда сектор держит оба тира — used равен их сумме', () => {
    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 100 },
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      2.5
    )
    const manager = new SectorManager(grid, generator, pool, thresholds, null, Infinity, 4)
    const vpMatrix = buildAllVisibleViewProjection(1000)
    const info0 = grid.getSectorInfo(0, 0, 0)

    manager.update(info0.centerAngle, info0.centerRadius, 0, vpMatrix, identity, 1.0)
    const settled = manager.usedInstances

    // Малая delta: кросс-фейд не успевает погаснуть, уходящий тир ещё жив
    manager.update(info0.centerAngle, info0.centerRadius + 7, 0, vpMatrix, identity, 0.001)
    expect(manager.usedInstances).toBe(settled * 2)

    // Дождаться конца фейда — уходящий тир освобождён, счёт возвращается
    manager.update(info0.centerAngle, info0.centerRadius + 7, 0, vpMatrix, identity, 1.0)
    expect(manager.usedInstances).toBe(settled)
  })

  it('смена тира упирается в долю пула по устоявшейся стоимости, а не по сумме двух тиров', () => {
    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 100 },
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      2.5
    )
    const info0 = grid.getSectorInfo(0, 0, 0)
    // Доля ровно под один тир: сумма двух тиров её превышает, устоявшаяся — нет
    const manager = new SectorManager(grid, generator, pool, thresholds, null, info0.instanceCount, 4)
    const vpMatrix = buildAllVisibleViewProjection(1000)

    manager.update(info0.centerAngle, info0.centerRadius, 0, vpMatrix, identity, 1.0)
    expect(manager.usedInstances).toBe(info0.instanceCount)

    // Смена тира проходит, хотя на время фейда оба тира в долю не влезают
    manager.update(info0.centerAngle, info0.centerRadius + 7, 0, vpMatrix, identity, 1.0)
    expect(manager.activeCount).toBe(1)
    expect(manager.getDebugInfo().capacityFailures).toBe(0)
  })

  it('deactivateAll обнуляет счёт занятых', () => {
    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 100 },
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      2.5
    )
    const manager = new SectorManager(grid, generator, pool, thresholds, null, Infinity, 4)
    const vpMatrix = buildAllVisibleViewProjection(1000)
    const info0 = grid.getSectorInfo(0, 0, 0)

    manager.update(info0.centerAngle, info0.centerRadius, 0, vpMatrix, identity, 1.0)
    expect(manager.usedInstances).toBeGreaterThan(0)

    manager.deactivateAll()
    expect(manager.usedInstances).toBe(0)
    expect(manager.activeCount).toBe(0)
  })

  it('смена тира ограничена тем же бюджетом: разом переключается не больше него', () => {
    // Много секторов в кадре: сетка из 16 угловых секторов одного слоя
    const wideConfig: SectorGridConfig = { ...gridConfig, innerRadius: 40, outerRadius: 60, cellSize: 20 }
    const grid = new SectorGrid(wideConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const pool = new InstancePool(
      { maxInstances: 4000 },
      { maxInstances: 4000 },
      { maxInstances: 4000 },
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
      2.5
    )
    const budget = 2
    const wideThresholds: LODThresholds = {
      l0MaxDistance: 60,
      l1MaxDistance: 400,
      nearEnterDistance: -1,
      nearExitDistance: -0.5
    }
    const manager = new SectorManager(grid, generator, pool, wideThresholds, null, Infinity, budget)
    const vpMatrix = buildAllVisibleViewProjection(1000)

    // Набрать секторы в тире Geometry: камера в центре, много кадров
    for (let i = 0; i < 40; i++) manager.update(0, 0, 0, vpMatrix, identity, 1.0)
    const active = manager.activeCount
    expect(active).toBeGreaterThan(budget)

    // Резкий отъезд: все активные разом просятся в Billboard. За кадр
    // переключиться должно не больше бюджета — иначе каскад держал бы два тира
    // у каждого сектора сразу
    const before = manager.usedInstances
    manager.update(0, 300, 0, vpMatrix, identity, 0.001)
    const switched = (manager.usedInstances - before) / grid.getSectorInfo(0, 0, 0).instanceCount

    expect(switched).toBeLessThanOrEqual(budget)
  })
})
