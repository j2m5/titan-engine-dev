import { describe, expect, it } from 'vitest'
import { ENVELOPE_GRID_HEIGHT, ENVELOPE_GRID_WIDTH, MidbandEnvelopeGrid } from '@/core/terrain/midbandEnvelopeGrid'
import type { MidbandEnvelope } from '@/core/terrain/midbandField'

const R_M = 1737400
const W = 256
const H = 128

describe('MidbandEnvelopeGrid: уклон, кривизна и сток из карты', () => {
  const out: MidbandEnvelope = { slopeTan: 0, curvature: 0, downE: 0, downN: 0 }

  it('плоская карта — уклон 0, кривизна 0', () => {
    const grid = new MidbandEnvelopeGrid(() => 1000, W, H, R_M)
    grid.sample(0.3, 0.5, out)
    expect(out.slopeTan).toBe(0)
    expect(out.curvature).toBe(0)
  })

  it('наклон на восток: уклон ≈ Δh/дуга, сток на запад (downE = −1)', () => {
    // h растёт с u: 10 м на тексель у экватора
    const texelArc = (2 * Math.PI * R_M) / W
    const grid = new MidbandEnvelopeGrid((u) => 10 * (u - Math.floor(u)) * W, W, H, R_M)
    grid.sample(0.5, 0.5, out)
    expect(out.slopeTan).toBeCloseTo(10 / texelArc, 5)
    expect(out.downE).toBeCloseTo(-1, 3)
    expect(Math.abs(out.downN)).toBeLessThan(1e-3)
  })

  it('кромка (локальный максимум) — кривизна положительная, яма — отрицательная; |κ| ≤ 1', () => {
    const grid = new MidbandEnvelopeGrid(
      (u, v) => 1000 * Math.cos(2 * Math.PI * 8 * u) * Math.cos(2 * Math.PI * 4 * v),
      W,
      H,
      R_M
    )
    grid.sample(0, 0, out) // cos = 1: максимум
    const peak = out.curvature
    grid.sample(1 / 16, 0, out) // cos(π) = −1: минимум
    const pit = out.curvature
    expect(peak).toBeGreaterThan(0.5)
    expect(pit).toBeLessThan(-0.5)
    expect(Math.abs(peak)).toBeLessThanOrEqual(1)
  })

  it('наклон на север: сток на юг (downN = −1) — ловит перевёрнутый знак gN', () => {
    // h растёт при убывающем v (север) — 10 м на тексель
    const grid = new MidbandEnvelopeGrid((_u, v) => -10 * v * H, W, H, R_M)
    grid.sample(0.5, 0.5, out)
    expect(out.downN).toBeCloseTo(-1, 3)
    expect(Math.abs(out.downE)).toBeLessThan(1e-3)
  })

  it('оборот по долготе: u = 1.2 ≡ 0.2; размеры сетки — константы', () => {
    const grid = new MidbandEnvelopeGrid((u) => 500 * Math.sin(2 * Math.PI * u), W, H, R_M)
    const a = { ...grid.sample(0.2, 0.4, out) }
    const b = { ...grid.sample(1.2, 0.4, out) }
    expect(b.slopeTan).toBeCloseTo(a.slopeTan, 9)
    expect(ENVELOPE_GRID_WIDTH).toBe(1024)
    expect(ENVELOPE_GRID_HEIGHT).toBe(512)
  })
})
