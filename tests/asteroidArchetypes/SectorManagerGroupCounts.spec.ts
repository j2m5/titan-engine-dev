import { describe, it, expect } from 'vitest'
import { BoxGeometry } from 'three'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool, Allocation } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import type { SectorBounds } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'

/** Библиотека того же размера, что боевая: раскладка по морфологиям зависит от K */
const K = 14

const makeGeometries = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))

const gridConfig: SectorGridConfig = { innerRadius: 497.5, outerRadius: 502.5, cellSize: 5, ringId: 555, densityPerUnit: 1.24 }
const thresholds: LODThresholds = { l0MaxDistance: 4, l1MaxDistance: 4, nearEnterDistance: -1, nearExitDistance: -0.5 }

type GroupAllocator = {
  allocateGeometryGroups(streamBase: number, seed: number, count: number, bounds: SectorBounds): Allocation[] | null
}

function buildScene(profile: 'stony' | undefined): { manager: SectorManager; generator: AsteroidGenerator; pool: InstancePool } {
  const grid = new SectorGrid(gridConfig)
  const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0, profile })
  const pool = new InstancePool(
    { maxInstances: 4000 },
    { maxInstances: 4000 },
    { maxInstances: 100 },
    makeGeometries(),
    makeGeometries(),
    2.5
  )
  return { manager: new SectorManager(grid, generator, pool, thresholds), generator, pool }
}

const bounds: SectorBounds = { minRadius: 497.5, maxRadius: 502.5, minAngle: 0, maxAngle: 0.01, minY: -0.5, maxY: 0.5 }

describe('SectorManager: аллокация групп архетипов совпадает с раскладкой генератора', () => {
  it.each([12345, 777, 2627])('seed %i, профиль stony: у каждой группы выделено ровно столько слотов, сколько матриц сгенерировано', (seed) => {
    const { manager, generator } = buildScene('stony')
    const count = 200
    const allocations = (manager as unknown as GroupAllocator).allocateGeometryGroups(0, seed, count, bounds)!
    const groups = generator.generateMatricesGrouped(seed, count, bounds, K)

    expect(allocations).not.toBeNull()
    for (const a of allocations) {
      expect(a.count, `stream ${a.stream}`).toBe(groups[a.stream].length / 16)
    }
    expect(allocations.reduce((s, a) => s + a.count, 0)).toBe(count)
  })

  it('без профиля раскладка равновероятная — тоже совпадает', () => {
    const { manager, generator } = buildScene(undefined)
    const allocations = (manager as unknown as GroupAllocator).allocateGeometryGroups(0, 4242, 150, bounds)!
    const groups = generator.generateMatricesGrouped(4242, 150, bounds, K)

    for (const a of allocations) expect(a.count).toBe(groups[a.stream].length / 16)
  })

  it('после аллокации ни один слот группы не остался с единичной матрицей (тело в начале сектора с масштабом 1)', () => {
    const { manager, pool } = buildScene('stony')
    const allocations = (manager as unknown as GroupAllocator).allocateGeometryGroups(0, 12345, 200, bounds)!

    for (const a of allocations) {
      const m = pool.geometryMeshes[a.stream].instanceMatrix.array as Float32Array
      for (let i = a.offset; i < a.offset + a.count; i++) {
        const translation = Math.hypot(m[i * 16 + 12], m[i * 16 + 13], m[i * 16 + 14])
        expect(translation, `stream ${a.stream} slot ${i}`).toBeGreaterThan(0)
      }
    }
  })
})
