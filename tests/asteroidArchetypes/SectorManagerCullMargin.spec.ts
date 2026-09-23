import { BoxGeometry, Matrix4, OrthographicCamera } from 'three'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const K = 3

/**
 * Ортографическая камера сверху вниз, нацеленная в (targetX, targetZ), полуширина
 * halfExtent — тот же приём, что и buildTightViewProjection в SectorManagerNearTier.
 * Сфера сектора (центр (sectorX, targetZ), т.к. dz всегда 0) включена, когда
 * max(0, |sectorX - targetX| - halfExtent) <= boundingRadius.
 */
function buildViewProjection(targetX: number, targetZ: number, halfExtent: number): Matrix4 {
  const camera = new OrthographicCamera(-halfExtent, halfExtent, halfExtent, -halfExtent, 0.1, 1000)
  camera.position.set(targetX, 500, targetZ)
  camera.up.set(0, 0, -1)
  camera.lookAt(targetX, 0, targetZ)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
}

const makeGeometries = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))

// Та же сетка, что в SectorManagerNearTier — тонкая полоса на большом радиусе,
// тайл ~квадратный, boundingRadius сравним с шагом сетки.
const gridConfig: SectorGridConfig = {
  innerRadius: 497.5,
  outerRadius: 502.5,
  cellSize: 5,
  ringId: 555,
  densityPerUnit: 1.24
}

// Near выключен; l0/l1 меньше расстояния до соседней ячейки (~5, хорда arcSpan,
// см. докблок buildViewProjection) — сосед исключается дистанцией ДО фрустума,
// изолируя ровно один кандидат независимо от формы бокса отсечения.
const thresholds: LODThresholds = {
  l0MaxDistance: 4,
  l1MaxDistance: 4,
  nearEnterDistance: -1,
  nearExitDistance: -0.5
}

const identity = new Matrix4()

function buildScene(): { grid: SectorGrid; manager: SectorManager } {
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
  return { grid, manager: new SectorManager(grid, generator, pool, thresholds) }
}

describe('SectorManager: запас отсечения вокруг кадра', () => {
  it('сектор у самой границы: точный фрустум не активирует, расширенный — активирует', () => {
    const { grid, manager } = buildScene()
    const info0 = grid.getSectorInfo(0, 0, 0)
    const br = info0.boundingRadius
    // Цель камеры смещена от истинного центра сектора вдоль X на 1.5·br —
    // сектор садится у самой границы бокса отсечения (см. формулу над buildViewProjection).
    const targetX = info0.centerX + br * 1.5

    const exact = buildViewProjection(targetX, info0.centerZ, br * 0.3) // 0.3·br < 0.5·br → снаружи
    manager.update(info0.centerAngle, info0.centerRadius, 0, exact, identity, 1.0)
    expect(manager.activeCount).toBe(0)

    const widened = buildViewProjection(targetX, info0.centerZ, br * 2.0) // 2·br > 0.5·br → внутри
    manager.update(info0.centerAngle, info0.centerRadius, 0, widened, identity, 1.0)
    expect(manager.activeCount).toBe(1)
  })
})
