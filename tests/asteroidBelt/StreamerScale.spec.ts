import { describe, it, expect } from 'vitest'
import { deriveStreamerScale, assertLodInvariant } from '@/core/renderables/DetailedRingStreamingSystem/streamerScale'
import { SectorGrid } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const TU_PER_KM: number = toThreeJSUnits(1)

describe('deriveStreamerScale', () => {
  it('плотность — обратный квадрат расстояния между камнями, в единицах сцены', () => {
    const s = deriveStreamerScale(60)
    const spacingTu: number = 60 * TU_PER_KM

    expect(s.densityPerUnit).toBeCloseTo(1 / (spacingTu * spacingTu), 6)
  })

  it('ячейка не меньше 2000 км и не меньше 24 расстояний', () => {
    expect(deriveStreamerScale(60).cellSizeKm).toBe(2000)
    expect(deriveStreamerScale(500).cellSizeKm).toBe(12000)
  })

  it('пороги LOD масштабируются от ячейки и держат инвариант', () => {
    for (const spacing of [10, 60, 500, 5000]) {
      const s = deriveStreamerScale(spacing)

      expect(() => assertLodInvariant(s.cellSizeKm, s.lodThresholdsKm)).not.toThrow()
      expect(s.lodThresholdsKm.l0Near).toBeLessThan(s.lodThresholdsKm.l0NearExit)
      expect(s.lodThresholdsKm.l0).toBeLessThan(s.lodThresholdsKm.l1)
    }
  })

  it('при ячейке колец пороги равны прежним константам колец', () => {
    // 2000 км: l0 6000, l1 12000, l0Near 2500, l0NearExit 3200 — дефолты стримера
    expect(deriveStreamerScale(60).lodThresholdsKm).toEqual({ l0: 6000, l1: 12000, l0Near: 2500, l0NearExit: 3200 })
  })

  it('инвариант ловит окно Near, накрывающее Geometry', () => {
    expect(() => assertLodInvariant(2000, { l0: 4000, l1: 12000, l0Near: 2500, l0NearExit: 3200 })).toThrow(/l0/)
  })
})

describe('SectorGrid — стохастический счёт под флагом stochasticCount', () => {
  const grid = (densityPerUnit: number, stochasticCount: boolean = false): SectorGrid =>
    new SectorGrid({ innerRadius: 100, outerRadius: 200, cellSize: 1, ringId: 7, densityPerUnit, stochasticCount })

  // Площадь сектора (50, 0) той же сетки — общий делитель для всех densityPerUnit ниже
  const probeArea: number = (() => {
    const info = grid(1).getSectorInfo(50, 0, 0)
    return 0.5 * (info.bounds.maxRadius ** 2 - info.bounds.minRadius ** 2) * (info.bounds.maxAngle - info.bounds.minAngle)
  })()

  it('флаг включён: среднее по многим секторам равно ожидаемому дробному счёту', () => {
    // area ≈ 1 → weighted ≈ 0.2
    const g = grid(0.2, true)
    let sum = 0
    const n = 4000

    for (let a = 0; a < n; a++) sum += g.getSectorInfo(50, a, 0).instanceCount

    expect(sum / n).toBeGreaterThan(0.15)
    expect(sum / n).toBeLessThan(0.25)
  })

  it('флаг включён: счёт детерминирован по ключу сектора', () => {
    const g = grid(0.2, true)

    expect(g.getSectorInfo(50, 123, 0).instanceCount).toBe(g.getSectorInfo(50, 123, 0).instanceCount)
  })

  it('при большой плотности — прежнее округление независимо от флага', () => {
    for (const stochasticCount of [false, true]) {
      const g = grid(500, stochasticCount)
      const info = g.getSectorInfo(50, 0, 0)
      const area: number =
        0.5 * (info.bounds.maxRadius ** 2 - info.bounds.minRadius ** 2) * (info.bounds.maxAngle - info.bounds.minAngle)

      expect(info.instanceCount).toBe(Math.max(1, Math.round(area * 500)))
    }
  })

  it('порог 0.5 — старая ветка колец: weighted = 0.7 детерминирован, всегда 1, независимо от флага', () => {
    for (const stochasticCount of [false, true]) {
      const g = grid(0.7 / probeArea, stochasticCount)

      for (let a = 0; a < 30; a++) expect(g.getSectorInfo(50, a, 0).instanceCount).toBe(1)
    }
  })

  it('флаг выключен (дефолт): weighted = 0.3 всегда 0 — прежний код колец', () => {
    const g = grid(0.3 / probeArea)

    for (let a = 0; a < 30; a++) expect(g.getSectorInfo(50, a, 0).instanceCount).toBe(0)
  })

  it('флаг включён: weighted = 0.3 разыгрывается по хешу сектора — оба исхода достижимы', () => {
    const outcomes = new Set<number>()

    for (let ringId = 0; ringId < 50; ringId++) {
      const g = new SectorGrid({
        innerRadius: 100,
        outerRadius: 200,
        cellSize: 1,
        ringId,
        densityPerUnit: 0.3 / probeArea,
        stochasticCount: true
      })
      outcomes.add(g.getSectorInfo(50, 0, 0).instanceCount)
    }

    expect(outcomes.has(0)).toBe(true)
    expect(outcomes.has(1)).toBe(true)
  })
})
