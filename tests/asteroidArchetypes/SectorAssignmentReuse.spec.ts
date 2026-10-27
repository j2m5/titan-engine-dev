import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Vector3 } from 'three'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool, type Allocation } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { SectorManager } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { SectorGrid, sectorCenter, type SectorBounds } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { RadialDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/RadialDensityProfile'
import type { AsteroidProfileName } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'

const K = 14
const bounds: SectorBounds = { minRadius: 100, maxRadius: 200, minAngle: 0.1, maxAngle: 0.2, minY: 3, maxY: 9 }
const origin = new Vector3(12, 2, -7)
type Allocator = {
  allocateGeometryGroups(base: number, seed: number, count: number, bounds: SectorBounds): Allocation[] | null
}
const bits = (data: Float32Array) => new Uint32Array(data.buffer, data.byteOffset, data.length)

function scene(profile: AsteroidProfileName | undefined, relative = true) {
  const generator = new AsteroidGenerator({
    thickness: 8,
    minScale: 0.5,
    maxScale: 2,
    sizeExponent: 1.7,
    profile,
    relativeToSector: relative,
    volumetric: relative
  })
  generator.setDensityProfile(new RadialDensityProfile([0.1, 1, 0.4, 0.7], 100, 200))
  const geometry = new BoxGeometry()
  const pool = new InstancePool(
    { maxInstances: 1000 },
    { maxInstances: 1000 },
    { maxInstances: 10 },
    Array(K).fill(geometry),
    Array(K).fill(geometry),
    1
  )
  const grid = new SectorGrid({ innerRadius: 100, outerRadius: 200, cellSize: 5, ringId: 55, densityPerUnit: 1 })
  const manager = new SectorManager(
    grid,
    generator,
    pool,
    { l0MaxDistance: 4, l1MaxDistance: 9, nearEnterDistance: 1, nearExitDistance: 2 },
    relative ? origin : null
  )
  return { generator, pool, manager: manager as unknown as Allocator }
}

it.each([undefined, 'stony', 'carbonaceous', 'metallic', 'icy'] as const)(
  'prepared assignment preserves matrix bits and buffer ownership for %s',
  (profile) => {
    const { generator } = scene(profile)
    for (const count of [0, 1, 37]) {
      const assignment = generator.archetypeAssignment(-1, count, K)
      const saved = assignment.slice()
      const flat = generator.generateMatrices(-1, count, bounds)
      const first = generator.generateMatricesGrouped(-1, count, bounds, K, assignment)
      const second = generator.generateMatricesGrouped(-1, count, bounds, K, assignment)
      expect(first).toHaveLength(K)
      for (let k = 0; k < K; k++) {
        const indices = Array.from(assignment.keys()).filter((i) => assignment[i] === k)
        expect(first[k]).toHaveLength(indices.length * 16)
        expect(first[k].buffer).not.toBe(second[k].buffer)
        for (let j = 0; j < indices.length; j++) {
          expect(bits(first[k].subarray(j * 16, (j + 1) * 16))).toEqual(
            bits(flat.subarray(indices[j] * 16, (indices[j] + 1) * 16))
          )
        }
        const savedSecond = second[k].slice()
        first[k].fill(NaN)
        expect(bits(second[k])).toEqual(bits(savedSecond))
      }
      expect(assignment).toEqual(saved)
    }
  }
)

describe.each([0, K])('sector assignment reuse, stream base %i', (base) => {
  it.each([undefined, 'stony', 'carbonaceous', 'metallic', 'icy'] as const)(
    'preserves group order and pool attributes for %s',
    (profile) => {
      const { manager, generator, pool } = scene(profile, profile !== undefined)
      for (const count of [0, 1, 37]) {
        const seed = count === 1 ? -1 : 777
        const assignment = generator.archetypeAssignment(seed, count, K)
        const flat = generator.generateMatrices(seed, count, bounds)
        const allocations = manager.allocateGeometryGroups(base, seed, count, bounds)!
        expect(allocations).not.toBeNull()
        expect(allocations.reduce((sum, a) => sum + a.count, 0)).toBe(count)
        for (const allocation of allocations) {
          const k = allocation.stream - base
          const indices = Array.from(assignment.keys()).filter((i) => assignment[i] === k)
          expect(allocation.count).toBe(indices.length)
          const mesh = base ? pool.nearMeshes[k] : pool.geometryMeshes[k]
          const matrices = mesh.instanceMatrix.array as Float32Array
          for (let j = 0; j < indices.length; j++) {
            const slot = allocation.offset + j
            expect(bits(matrices.subarray(slot * 16, (slot + 1) * 16))).toEqual(
              bits(flat.subarray(indices[j] * 16, (indices[j] + 1) * 16))
            )
            expect(mesh.geometry.getAttribute('instanceFade').getX(slot)).toBe(0)
            expect(mesh.geometry.getAttribute('instanceMaxDistance').getX(slot)).toBe(9)
            const center = sectorCenter(bounds)
            const expected =
              profile === undefined
                ? [0, 0, 0]
                : [center.x - origin.x, center.y - origin.y, center.z - origin.z].map(Math.fround)
            const attr = mesh.geometry.getAttribute('instanceOrigin')
            expect([attr.getX(slot), attr.getY(slot), attr.getZ(slot)]).toEqual(expected)
          }
          pool.release(allocation)
        }
        expect(pool.getActiveCount().total).toBe(0)
      }
    }
  )

  it('computes the morphology assignment once per successful allocation', () => {
    const { manager, generator } = scene('stony')
    const selection = vi.spyOn(generator, 'archetypeAssignment')
    try {
      expect(manager.allocateGeometryGroups(base, 777, 200, bounds)).not.toBeNull()
      expect(selection).toHaveBeenCalledTimes(1)
    } finally {
      selection.mockRestore()
    }
  })

  it('rolls back partial allocation without matrix generation and can retry', () => {
    const { manager, generator, pool } = scene('stony')
    // Occupy the second nonempty group, forcing a failure after an earlier allocation.
    const assignment = generator.archetypeAssignment(777, 200, K)
    const occupiedGroups = [...new Set(assignment)].sort((a, b) => a - b)
    expect(occupiedGroups.length).toBeGreaterThan(1)
    const stream = base + occupiedGroups[1]
    const capacity = (base ? pool.nearMeshes : pool.geometryMeshes)[occupiedGroups[1]].instanceMatrix.count
    const blocker = pool.allocate(stream, capacity)!
    expect(blocker).not.toBeNull()
    const generation = vi.spyOn(generator, 'generateMatricesGrouped')
    try {
      expect(manager.allocateGeometryGroups(base, 777, 200, bounds)).toBeNull()
      expect(generation).not.toHaveBeenCalled()
      expect(pool.getActiveCount().total).toBe(capacity)
      pool.release(blocker)
      const retry = manager.allocateGeometryGroups(base, 777, 200, bounds)!
      expect(retry).not.toBeNull()
      expect(retry.reduce((sum, a) => sum + a.count, 0)).toBe(200)
      for (const a of retry) pool.release(a)
      expect(pool.getActiveCount().total).toBe(0)
    } finally {
      generation.mockRestore()
    }
  })
})
