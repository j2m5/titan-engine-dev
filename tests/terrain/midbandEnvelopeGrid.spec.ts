import { describe, expect, it } from 'vitest'
import { ENVELOPE_GRID_HEIGHT, ENVELOPE_GRID_WIDTH, MidbandEnvelopeGrid, percentile99Abs } from '@/core/terrain/midbandEnvelopeGrid'
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

// Раскладка лапласиана на сетке ENVELOPE_GRID_WIDTH×HEIGHT — та же формула,
// что в конструкторе MidbandEnvelopeGrid (лапласиан на однотекселном шаге
// duFixed/dv, север = убывающий v), воспроизведена здесь напрямую (не через
// класс — у него нет геттера сырой кривизны), чтобы независимо посчитать
// сортировочный p99 «в лоб» и сравнить с гистограммной оценкой производства.
function curvatureRawArray(sampleMeters: (u: number, v: number) => number, mapWidth: number, mapHeight: number, radiusMeters: number): Float32Array {
  const w = ENVELOPE_GRID_WIDTH
  const h = ENVELOPE_GRID_HEIGHT
  const curvatureRaw = new Float32Array(w * h)
  const texelArcN = (Math.PI * radiusMeters) / mapHeight
  const dv = 1 / mapHeight
  const duFixed = 1 / mapWidth

  for (let row = 0; row < h; row++) {
    const v = (row + 0.5) / h
    for (let col = 0; col < w; col++) {
      const u = (col + 0.5) / w
      const center = sampleMeters(u, v)
      const east1 = sampleMeters(u + duFixed, v)
      const east0 = sampleMeters(u - duFixed, v)
      const north1 = sampleMeters(u, v - dv) // север = убывающий v
      const north0 = sampleMeters(u, v + dv)
      const lap = (east1 + east0 + north1 + north0 - 4 * center) / (texelArcN * texelArcN)
      curvatureRaw[row * w + col] = -lap
    }
  }

  return curvatureRaw
}

describe('percentile99Abs: гистограммная оценка против сортировки (I2)', () => {
  it('на синусоидальной карте гистограммный p99 отличается от сортировочного не более чем на 2% от max|κ|', () => {
    const sample = (u: number, v: number): number => 1000 * Math.cos(2 * Math.PI * 8 * u) * Math.cos(2 * Math.PI * 4 * v)
    const raw = curvatureRawArray(sample, W, H, R_M)

    const sorted = Float64Array.from(raw, (v) => Math.abs(v))
    sorted.sort()
    const maxAbs = sorted[sorted.length - 1]
    const sortP99 = sorted[Math.floor(0.99 * (sorted.length - 1))]

    const histP99 = percentile99Abs(raw)

    expect(histP99).toBeGreaterThanOrEqual(sortP99) // гистограмма — верхняя граница бина, не занижает
    expect(Math.abs(histP99 - sortP99)).toBeLessThanOrEqual(0.02 * maxAbs)
  })
})
