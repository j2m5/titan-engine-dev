import { BoxGeometry, Matrix4, OrthographicCamera } from 'three'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const K = 3

function buildAllVisibleViewProjection(extent: number): Matrix4 {
  const camera = new OrthographicCamera(-extent, extent, extent, -extent, 0.1, extent * 4)
  camera.position.set(0, 0, extent * 2)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
}

const makeGeometries = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))

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
const vpMatrix = buildAllVisibleViewProjection(1000)

function makeManager(): { manager: SectorManager; pool: InstancePool; grid: SectorGrid } {
  const grid = new SectorGrid(gridConfig)
  const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
  const pool = new InstancePool(
    { maxInstances: 300 },
    { maxInstances: 300 },
    { maxInstances: 300 },
    makeGeometries(),
    makeGeometries(),
    2.5
  )

  return { manager: new SectorManager(grid, generator, pool, thresholds), pool, grid }
}

describe('SectorManager: паритет числа камней между тирами', () => {
  /**
   * Инвариант, нарушение которого и было багом «камень исчезает при приближении».
   *
   * Генератор потребляет rng строго последовательно по индексу инстанса,
   * поэтому камни 0..N-1 при любом count получаются байт-в-байт одинаковыми.
   * Следствие: если билборд-тир генерит БОЛЬШЕ инстансов, чем геометрический,
   * то лишний хвост существует ТОЛЬКО как импостор — геометрического двойника
   * у него нет, и на переходе L1 → L0 он гаснет навсегда.
   */
  it('у каждого импостора есть геометрический двойник: число камней сектора совпадает в обоих тирах', () => {
    const { manager, pool, grid } = makeManager()
    const info0 = grid.getSectorInfo(0, 0)

    // Дальше l0MaxDistance, но ближе l1MaxDistance → сектор поднимается как Billboard.
    manager.update(info0.centerAngle, info0.centerRadius + 7, vpMatrix, identity, 1.0)
    const billboardCount = pool.getPressureInfo().l1.used

    expect(billboardCount).toBeGreaterThan(0)

    // Подходим вплотную → Geometry; большая delta досматривает кросс-фейд до конца.
    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)
    const geometryCount = pool.getPressureInfo().l0.used

    expect(geometryCount).toBe(billboardCount)
  })

  /**
   * Тот же инвариант со стороны конфигурации: множитель плотности билборда,
   * превышающий геометрический, воспроизводит баг по построению.
   */
  it('множитель плотности билборда не превышает геометрический', () => {
    const { manager, pool, grid } = makeManager()
    const info0 = grid.getSectorInfo(0, 0)

    manager.update(info0.centerAngle, info0.centerRadius, vpMatrix, identity, 1.0)
    const geometryCount = pool.getPressureInfo().l0.used

    manager.update(info0.centerAngle, info0.centerRadius + 7, vpMatrix, identity, 1.0)
    const billboardCount = pool.getPressureInfo().l1.used

    expect(billboardCount).toBeLessThanOrEqual(geometryCount)
  })
})
