import { describe, it, expect } from 'vitest'
import { BoxGeometry, Matrix4, OrthographicCamera, Vector3 } from 'three'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

/**
 * Ортокамера сверху, нацеленная точно на (centerX, centerZ) — bounding sphere
 * целевого сектора всегда пересекает даже маленький бокс (центр внутри),
 * держит его в кадре независимо от halfExtent.
 */
function buildTopViewProjection(centerX: number, centerZ: number, halfExtent: number): Matrix4 {
  const camera = new OrthographicCamera(-halfExtent, halfExtent, halfExtent, -halfExtent, 0.1, 1000)
  camera.position.set(centerX, 500, centerZ)
  camera.up.set(0, 0, -1)
  camera.lookAt(centerX, 0, centerZ)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
}

// Тонкая радиальная полоса на большом радиусе — ОДИН радиальный слой
// (outerRadius - innerRadius == cellSize), соседи только по углу.
const RADIUS_CONFIG = { innerRadius: 497.5, outerRadius: 502.5, cellSize: 5 } as const

// Порог меньше углового шага соседней ячейки (~5 units дуги): угловое окно
// кандидатов схлопывается до самого сектора, а случайный сосед, всё же
// попавший в грубое окно, отсеивается точной проверкой dist − boundingRadius.
const thresholds: LODThresholds = {
  l0MaxDistance: 0.5,
  l1MaxDistance: 0.5,
  nearEnterDistance: -1,
  nearExitDistance: -0.5
}

const identity = new Matrix4()

describe('SectorManager: origin несёт высоту ячейки (объёмная сетка)', () => {
  it('ячейка выше средней плоскости пишет в instanceOrigin.y центр СВОЕЙ высоты, а не 0', () => {
    const gridConfig: SectorGridConfig = {
      ...RADIUS_CONFIG,
      ringId: 555,
      densityPerUnit: 0.4,
      heightExtent: 4,
      cellHeight: 2
    }
    const grid = new SectorGrid(gridConfig)
    expect(grid.volumetric).toBe(true)

    // yIndex 1 — верхняя половина толщины (centerY > 0), вне средней плоскости
    const info = grid.getSectorInfo(0, 0, 1)
    expect(info.centerY).toBeGreaterThan(0)
    expect(info.instanceCount).toBeGreaterThan(0)

    const generator = new AsteroidGenerator({
      thickness: gridConfig.heightExtent as number,
      minScale: 0.5,
      maxScale: 1.0,
      relativeToSector: true,
      volumetric: true
    })
    const pool = new InstancePool(
      { maxInstances: 100 },
      { maxInstances: 100 },
      { maxInstances: 100 },
      [new BoxGeometry(1, 1, 1)],
      [new BoxGeometry(1, 1, 1)],
      2.5
    )
    // Ненулевой Y плавающего начала — проверяем общую формулу (center.y - origin.y),
    // а не частный случай origin.y == 0 (единственный, что даёт FloatingOrigin сегодня)
    const origin = new Vector3(1000, 3, 2000)
    const manager = new SectorManager(grid, generator, pool, thresholds, origin)

    const vpMatrix = buildTopViewProjection(info.centerX, info.centerZ, 10)
    manager.update(info.centerAngle, info.centerRadius, info.centerY, vpMatrix, identity, 1.0)

    expect(manager.activeCount).toBe(1)
    pool.commitUpdates()

    const mesh = pool.geometryMeshes[0]
    expect(mesh.count).toBe(info.instanceCount)

    const origins = mesh.geometry.getAttribute('instanceOrigin').array as Float32Array
    const matrices = mesh.instanceMatrix.array as Float32Array
    const expectedOriginY = info.centerY - origin.y

    for (let i = 0; i < mesh.count; i++) {
      const originY = origins[i * 3 + 1]
      const localY = matrices[i * 16 + 13]

      // БАГ: origin.y хардкожен в 0 → камни всплывали бы к «-origin.y» вместо
      // реальной высоты ячейки. Атрибут обязан нести именно центр ячейки.
      expect(originY).toBeCloseTo(expectedOriginY, 3)

      // Абсолютная высота (origin + local) остаётся внутри границ СВОЕЙ ячейки
      const absoluteY = originY + localY
      expect(absoluteY).toBeGreaterThanOrEqual(info.bounds.minY - origin.y - 1e-6)
      expect(absoluteY).toBeLessThanOrEqual(info.bounds.maxY - origin.y + 1e-6)
    }
  })

  it('кольцо (плоская сетка): origin.y всегда 0 — centerY ячейки лежит в средней плоскости', () => {
    const grid = new SectorGrid({ ...RADIUS_CONFIG, ringId: 39, densityPerUnit: 0.4 })
    expect(grid.volumetric).toBe(false)

    const info = grid.getSectorInfo(0, 0, 0)
    expect(info.centerY).toBe(0)
    expect(info.instanceCount).toBeGreaterThan(0)

    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0, relativeToSector: true })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 300 },
      [new BoxGeometry(1, 1, 1)],
      [new BoxGeometry(1, 1, 1)],
      2.5
    )
    // FloatingOrigin.origin.y в проде всегда 0 (плавающее начало квантуется
    // только в плоскости XZ) — рингу неоткуда взять ненулевой Y плавающего начала
    const origin = new Vector3(1000, 0, 2000)
    const manager = new SectorManager(grid, generator, pool, thresholds, origin)

    const vpMatrix = buildTopViewProjection(info.centerX, info.centerZ, 10)
    manager.update(info.centerAngle, info.centerRadius, 0, vpMatrix, identity, 1.0)

    expect(manager.activeCount).toBe(1)
    pool.commitUpdates()

    const mesh = pool.geometryMeshes[0]
    expect(mesh.count).toBe(info.instanceCount)

    const origins = mesh.geometry.getAttribute('instanceOrigin').array as Float32Array
    for (let i = 0; i < mesh.count; i++) {
      expect(origins[i * 3 + 1]).toBe(0)
    }
  })
})
