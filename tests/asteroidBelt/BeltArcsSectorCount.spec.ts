import { describe, it, expect, vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => ({ name: 'ring.png' }), getTextureOrMake: () => ({ name: 'ring.png' }) }
}))
vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { SectorGrid } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AngularDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/AngularDensityProfile'
import { buildBeltAngularProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'
import type { Actor } from '@/core/models/Actor'
import { internalsOf, angularProfileOf } from '../helpers/ringSystemInternals'

const flat = { edgeSoftness: 0, gaps: [], clumps: [] }
/** Дуга на четверти оборота (θ₀ = π/2), пик gain / фон = 2 */
const ARC = { at: 0.25, width: 0.04, gain: 2 }

const makeGrid = (): SectorGrid =>
  new SectorGrid({ innerRadius: 40, outerRadius: 60, cellSize: 1, ringId: 7, densityPerUnit: 400 })

/** Сектор слоя с центром ближе всего к углу */
const sectorNearest = (grid: SectorGrid, layerIndex: number, angle: number) => {
  const layer = grid.layerAt(layerIndex)
  const angleIndex = Math.floor(angle / layer.angularStep)
  return grid.getSectorInfo(layerIndex, angleIndex, 0)
}

describe('SectorGrid: дуги взвешивают счёт камней сектора', () => {
  it('у дуги камней вдвое больше (≈ gain), чем напротив; вес сектора — среднее профиля', () => {
    const grid = makeGrid()
    grid.setAngularProfile(new AngularDensityProfile(buildBeltAngularProfile({ ...flat, arcs: [ARC] })!))

    const peak = sectorNearest(grid, 10, Math.PI / 2)
    const opposite = sectorNearest(grid, 10, 1.5 * Math.PI)

    expect(peak.centerAngle).toBeCloseTo(Math.PI / 2, 1)
    expect(peak.instanceCount).toBeGreaterThan(100)
    expect(peak.instanceCount / opposite.instanceCount).toBeCloseTo(ARC.gain, 1)
  })

  it('без профиля (или после сброса в null) счёт побитово прежний', () => {
    const reference = makeGrid()
    const withProfile = makeGrid()
    withProfile.setAngularProfile(new AngularDensityProfile(buildBeltAngularProfile({ ...flat, arcs: [ARC] })!))
    const reset = makeGrid()
    reset.setAngularProfile(new AngularDensityProfile(buildBeltAngularProfile({ ...flat, arcs: [ARC] })!))
    reset.setAngularProfile(null)

    const layer = reference.layerAt(5)
    let differs = 0
    for (let ai = 0; ai < layer.angularSectorCount; ai++) {
      const a = reference.getSectorInfo(5, ai, 0)
      const b = reset.getSectorInfo(5, ai, 0)
      expect(b.instanceCount).toBe(a.instanceCount)
      expect(b.seed).toBe(a.seed)
      expect(b.key).toBe(a.key)
      if (withProfile.getSectorInfo(5, ai, 0).instanceCount !== a.instanceCount) differs++
    }
    expect(differs).toBeGreaterThan(0)
  })

  it('сумма камней слоя с дугой равна сумме без дуги (профиль перераспределяет, не добавляет)', () => {
    const reference = makeGrid()
    const withProfile = makeGrid()
    withProfile.setAngularProfile(new AngularDensityProfile(buildBeltAngularProfile({ ...flat, arcs: [ARC] })!))

    const layer = reference.layerAt(5)
    let sumRef = 0
    let sumArc = 0
    for (let ai = 0; ai < layer.angularSectorCount; ai++) {
      sumRef += reference.getSectorInfo(5, ai, 0).instanceCount
      sumArc += withProfile.getSectorInfo(5, ai, 0).instanceCount
    }
    expect(Math.abs(sumArc - sumRef) / sumRef).toBeLessThan(0.01)
  })
})

describe('AsteroidRingSystem: angularProfileSource доходит до всех каскадов', () => {
  const beltActor = (): Actor =>
    ({
      getAttribute: () => 1,
      renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1 }) },
      resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
    }) as unknown as Actor

  it('один и тот же профиль во всех сетках каскадов', () => {
    const source = buildBeltAngularProfile({ ...flat, arcs: [ARC] })!
    const system = new AsteroidRingSystem(beltActor(), { angularProfileSource: source })
    const grids = (system as unknown as { cascadeGrids: SectorGrid[] }).cascadeGrids

    expect(grids.length).toBeGreaterThan(0)
    const first = angularProfileOf(grids[0])
    expect(first).toBeInstanceOf(AngularDensityProfile)
    for (const grid of grids) expect(angularProfileOf(grid)).toBe(first)
    expect(first!.weightForRange(0, Math.PI * 2)).toBeCloseTo(1, 5)
  })

  it('без angularProfileSource профиля в сетке нет — путь колец', () => {
    const system = new AsteroidRingSystem(beltActor(), {})
    expect(angularProfileOf(internalsOf(system).sectorGrid)).toBeNull()
  })
})
