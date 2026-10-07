import { describe, expect, it } from 'vitest'
import {
  FLARE_GHOSTS,
  GHOST_CUTOFF,
  GHOST_REFERENCE,
  GHOST_SCALE,
  GHOST_SQUEEZE,
  RING_WIDTH,
  ghostEnergy,
  ghostPeakOnScreen,
  ghostProfile,
  ghostVignette,
  lumaNormalized,
  profileExtent,
  profileIntegral,
  profilePeak
} from '@/core/graphic/effects/lensflare/flareGhosts'
import { FLUX_REFERENCE_HEIGHT } from '@/core/graphic/effects/lensflare/flareGrid'

const frameFlux = (pixels: number): number => pixels / FLUX_REFERENCE_HEIGHT ** 2
const luma = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

describe('призраки: таблица', () => {
  it('восемь призраков, положения конечны и не в центре', () => {
    expect(FLARE_GHOSTS).toHaveLength(8)
    for (const g of FLARE_GHOSTS) {
      expect(Number.isFinite(g.m)).toBe(true)
      expect(Math.abs(g.m)).toBeGreaterThan(0.1)
      expect(Math.abs(g.m)).toBeLessThanOrEqual(1.5)
    }
  })

  it('овалы вертикальные — анаморфная подпись', () => {
    expect(GHOST_SQUEEZE).toBeLessThan(1)
  })

  it('ровно один тёплый призрак, остальные холодные', () => {
    expect(FLARE_GHOSTS.filter((g) => g.tint[0] > g.tint[2])).toHaveLength(1)
  })

  it('оттенок нормирован по яркости', () => {
    for (const g of FLARE_GHOSTS) expect(luma(lumaNormalized(g.tint))).toBeCloseTo(1, 12)
  })
})

describe('призраки: профили', () => {
  it('диск: центр 1, обод светлее середины, за краем ноль', () => {
    expect(ghostProfile(0, 'disc')).toBeCloseTo(1, 6)
    expect(ghostProfile(0.85, 'disc')).toBeGreaterThan(ghostProfile(0.5, 'disc'))
    expect(ghostProfile(1, 'disc')).toBe(0)
  })

  it('кольцо: пик на радиусе 1, в центре ноль', () => {
    expect(ghostProfile(1, 'ring')).toBe(1)
    expect(ghostProfile(0, 'ring')).toBeLessThan(1e-12)
  })

  it('интеграл кольца — 2π·w·√π, диска — между мягким кругом и кругом с ободом', () => {
    expect(profileIntegral('ring')).toBeCloseTo(2 * Math.PI * RING_WIDTH * Math.sqrt(Math.PI), 4)
    expect(profileIntegral('disc')).toBeGreaterThan(Math.PI * 0.85 ** 2)
    expect(profileIntegral('disc')).toBeLessThan(Math.PI * 1.35)
  })

  it('граница квада покрывает профиль: за ней меньше 1e-3 пика', () => {
    for (const p of ['disc', 'ring'] as const) {
      expect(ghostProfile(profileExtent(p) + 1e-6, p) / profilePeak(p)).toBeLessThan(1e-3)
    }
  })
})

describe('призраки: энергия', () => {
  it('калибровка: звезда 12 px в центре даёт самый яркий призрак 0.05', () => {
    const peaks = FLARE_GHOSTS.map((g) =>
      ghostPeakOnScreen(g, frameFlux(GHOST_REFERENCE.fluxPixels), 1, 1, GHOST_REFERENCE.intensity)
    )

    expect(Math.max(...peaks)).toBeCloseTo(0.05, 10)
  })

  it('вдвое больший призрак с той же долей вчетверо тусклее', () => {
    const g = FLARE_GHOSTS[0]

    expect(ghostEnergy({ ...g, radius: g.radius * 2 }) / ghostEnergy(g)).toBeCloseTo(0.25, 10)
  })

  it('яркость × площадь = доля потока × калибровка — у всех призраков одинаково', () => {
    for (const g of FLARE_GHOSTS) {
      const area = g.radius * g.radius * GHOST_SQUEEZE * profileIntegral(g.profile)
      expect((ghostEnergy(g) * area) / g.share).toBeCloseTo(GHOST_SCALE, 6)
    }
  })

  it('фоновая звезда (поток 3) не рисует ни одного призрака', () => {
    for (const g of FLARE_GHOSTS) expect(ghostPeakOnScreen(g, frameFlux(3), 1, 1, 0.1)).toBeLessThan(GHOST_CUTOFF)
  })

  it('звезда сцены рисует призраков', () => {
    expect(FLARE_GHOSTS.some((g) => ghostPeakOnScreen(g, frameFlux(3400), 1, 1, 0.1) > GHOST_CUTOFF)).toBe(true)
  })
})

describe('призраки: виньетирование', () => {
  it('в центре 1, к углу монотонно падает почти до нуля', () => {
    const aspect = 16 / 9
    const corner = 0.5 * Math.hypot(aspect, 1)
    let previous = ghostVignette([0, 0], aspect, 2)
    expect(previous).toBe(1)
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const v = ghostVignette([t * corner * 0.8, t * corner * 0.6], aspect, 2)
      expect(v).toBeLessThan(previous)
      previous = v
    }
    expect(previous).toBeLessThan(1e-6)
  })

  it('показатель 0 — виньетирования нет', () => {
    expect(ghostVignette([0.8, 0.4], 16 / 9, 0)).toBe(1)
  })
})
