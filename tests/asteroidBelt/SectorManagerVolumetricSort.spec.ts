import { describe, it, expect } from 'vitest'
import { BoxGeometry, Matrix4, OrthographicCamera } from 'three'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { activeSectorKeysOf } from '../helpers/ringSystemInternals'

/** Ортокамера с огромным охватом по X/Y/Z — все секторы теста внутри frustum независимо от их позы */
function wideViewProjection(extent: number): Matrix4 {
  const camera = new OrthographicCamera(-extent, extent, extent, -extent, 0.1, extent * 4)
  camera.position.set(0, 0, extent * 2)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
}

describe('SectorManager: активация на объёмной сетке учитывает высоту в сортировке', () => {
  it('бюджет 1 — при равной XZ-проекции выигрывает сектор на уровне высоты камеры (dy = 0)', () => {
    // Высота ячейки (500) на порядок больше радиальных/угловых масштабов (~50–100):
    // разница по Y решает исход сравнения, если сортировка её вообще учитывает.
    // Два ближайших по углу сектора (angleIndex 0 и 5, xz одинаков у обоих) существуют
    // на ОБОИХ уровнях высоты: пара с dy = 0 (уровень камеры) строго ближе в 3D, чем
    // пара с dy = 500, хотя по проекции на XZ все четыре неразличимы (тай).
    const gridConfig: SectorGridConfig = {
      innerRadius: 0,
      outerRadius: 100,
      cellSize: 100,
      ringId: 1,
      densityPerUnit: 0.05,
      heightExtent: 1000,
      cellHeight: 500
    }
    const grid = new SectorGrid(gridConfig)
    expect(grid.volumetric).toBe(true)

    const camX = 50
    const camZ = 0
    const cameraY = 250 // ровно центр yIndex=1

    const near0 = grid.getSectorInfo(0, 0, 1) // dy = 0
    const near5 = grid.getSectorInfo(0, 5, 1) // dy = 0
    const far0 = grid.getSectorInfo(0, 0, 0) // тот же угол, dy = 500
    const far5 = grid.getSectorInfo(0, 5, 0) // тот же угол, dy = 500

    const xzOf = (i: typeof near0): number => Math.hypot(i.centerX - camX, i.centerZ - camZ)
    const dist3dOf = (i: typeof near0): number => Math.hypot(i.centerX - camX, i.centerZ - camZ, i.centerY - cameraY)

    // Постановка: проекция на XZ у всех четырёх ОДИНАКОВА (тай) — метрика без dy
    // не может их различить; но в честном 3D-расстоянии near-пара вдвое ближе far-пары
    expect(xzOf(near0)).toBeCloseTo(xzOf(far0), 6)
    expect(xzOf(near5)).toBeCloseTo(xzOf(far5), 6)
    expect(dist3dOf(near0)).toBeLessThan(dist3dOf(far0))
    expect(dist3dOf(near5)).toBeLessThan(dist3dOf(far5))

    const generator = new AsteroidGenerator({
      thickness: gridConfig.heightExtent ?? 0,
      minScale: 0.5,
      maxScale: 1.0,
      volumetric: true
    })
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 300 },
      [new BoxGeometry(1, 1, 1)],
      [new BoxGeometry(1, 1, 1)],
      2.5
    )
    // l0 отрицателен — все кандидаты сразу Billboard, без веток Near/Geometry
    const thresholds: LODThresholds = {
      l0MaxDistance: -1,
      l1MaxDistance: 600,
      nearEnterDistance: -10,
      nearExitDistance: -5
    }
    // Бюджет 1 — за кадр активируется РОВНО один сектор из всех желаемых
    const manager = new SectorManager(grid, generator, pool, thresholds, null, Infinity, 1)

    manager.update(0, camX, cameraY, wideViewProjection(1000), new Matrix4(), 1.0)

    expect(manager.activeCount).toBe(1)
    const keys = activeSectorKeysOf(manager)

    // Пин: выигрывает уровень высоты камеры (near0/near5) — без dy в сортировке
    // тай по XZ решался бы порядком вставки (сначала yIndex=0 — см.
    // SectorGrid.getSectorsInRange), и бюджет забрал бы far0/far5.
    expect([near0.key, near5.key]).toContain(keys[0])
    expect(keys[0]).not.toBe(far0.key)
    expect(keys[0]).not.toBe(far5.key)
  })
})
