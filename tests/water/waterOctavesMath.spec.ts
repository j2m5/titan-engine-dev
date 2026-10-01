import { describe, expect, it } from 'vitest'
import {
  WATER_DEFAULT_PIXEL_ANGLE, WATER_DETAIL_PERIOD_METERS, WATER_DETAIL_WRAP_METERS, WATER_GLINT_CEILING,
  WATER_OCTAVE_SLOPE_VARIANCE, WATER_RIPPLE_OCTAVE_GAIN, WATER_RIPPLE_PERIODS_METERS, WATER_TRIPLANAR_SLOPE_GAIN2,
  absorptionLayer, footprintMeters, glintAlpha2, octaveWeight, rippleSpeedMps, waterGlint, waterTransmittance
} from '@/core/materials/shaders/lib/chunks/waterOctavesMath'
import { WRAP_TILES } from '@/core/terrain/detailWrap'

const RIPPLE_ONES = [1, 1, 1, 1, 1]
const BIG_ONES = [1, 1, 1, 1]

describe('waterOctavesMath: октавы', () => {
  it('каждый период мелкой октавы делит обёртку домена — иначе шов на границе патчей', () => {
    for (const p of WATER_RIPPLE_PERIODS_METERS) expect(WATER_DETAIL_WRAP_METERS % p).toBe(0)
  })
  it('обёртка домена воды — WRAP_TILES периодов мелкой ряби, как у кодировщика detailPos', () => {
    expect(WATER_DETAIL_WRAP_METERS).toBe(WATER_DETAIL_PERIOD_METERS * WRAP_TILES)
  })
  it('угол пикселя по умолчанию — номинальный кадр 50°/1080p, не 0 (0 — все веса 1 с орбиты)', () => {
    expect(WATER_DEFAULT_PIXEL_ANGLE).toBeCloseTo((2 * Math.tan((50 * Math.PI) / 360)) / 1080, 15)
  })
  it('скорость растёт как √λ, у 3000 м — 6 м/с', () => {
    expect(rippleSpeedMps(3000)).toBeCloseTo(6, 12)
    expect(rippleSpeedMps(30)).toBeCloseTo(0.6, 12)
  })
  it('вес: 1 при λ ≥ 4f, 0 при λ ≤ 2f, монотонен', () => {
    expect(octaveWeight(40, 10)).toBe(1)
    expect(octaveWeight(40, 20)).toBe(0)
    let prev = 1
    for (let f = 10; f <= 20; f += 0.5) {
      const w = octaveWeight(40, f)
      expect(w).toBeLessThanOrEqual(prev)
      prev = w
    }
  })
  it('футпринт: d·угол/μv, скользящий взгляд клампится к 0.2 — конечный', () => {
    expect(footprintMeters(1000, 0.001, 1)).toBeCloseTo(1, 12)
    expect(footprintMeters(1000, 0.001, 0)).toBeCloseTo(5, 12)
  })
})

describe('waterOctavesMath: блик', () => {
  it('калибровка ряби: сумма дисперсий 5 мелких октав = дисперсии среднего 4 крупных', () => {
    expect(WATER_RIPPLE_OCTAVE_GAIN).toBeCloseTo(1 / Math.sqrt(20), 15)
    const V = WATER_TRIPLANAR_SLOPE_GAIN2 * WATER_OCTAVE_SLOPE_VARIANCE
    const rippleSum = WATER_RIPPLE_PERIODS_METERS.length * WATER_RIPPLE_OCTAVE_GAIN ** 2 * V
    expect(Math.abs(rippleSum - V / 4)).toBeLessThan(1e-12)
    // то же через α²: все мелкие погасли ≡ все крупные погасли
    const allRipple = glintAlpha2(0, [0, 0, 0, 0, 0], BIG_ONES, 1)
    const allBig = glintAlpha2(0, RIPPLE_ONES, [0, 0, 0, 0], 1)
    expect(Math.abs(allRipple - allBig)).toBeLessThan(1e-12)
    expect(allRipple).toBeCloseTo(0.036151875, 12)
  })
  it('шероховатость: мелкие — Σ(1 − w)·(s·gain)²·2.25·V, крупные — Σ(1 − w)·2.25·V/16 (доля среднего)', () => {
    const a = glintAlpha2(0.02, RIPPLE_ONES, BIG_ONES, 1)
    expect(a).toBeCloseTo(0.02 ** 2, 12)
    expect(WATER_TRIPLANAR_SLOPE_GAIN2).toBe(2.25)
    // 1.5 погасшей мелкой октавы: 2.25·1.5·V/20
    expect(glintAlpha2(0.02, [1, 0, 0.5, 1, 1], BIG_ONES, 1) - a).toBeCloseTo(0.0108455625, 12)
    // 1.5 погасшей крупной октавы: 2.25·1.5·V/16
    expect(glintAlpha2(0.02, RIPPLE_ONES, [0, 1, 0.5, 1], 1) - a).toBeCloseTo(0.013556953125, 12)
  })
  it('сила ряби — только на мелкие октавы', () => {
    const a = glintAlpha2(0.02, RIPPLE_ONES, BIG_ONES, 2)
    // 2.25·2²·V/20
    expect(glintAlpha2(0.02, [0, 1, 1, 1, 1], BIG_ONES, 2) - a).toBeCloseTo(0.0289215, 12)
    // крупная от силы не зависит: 2.25·V/16
    expect(glintAlpha2(0.02, RIPPLE_ONES, [0, 1, 1, 1], 2) - a).toBeCloseTo(0.009037968750, 12)
  })
  it('α² не ниже пола — степень конечна, блик без NaN', () => {
    expect(glintAlpha2(1e-6, RIPPLE_ONES, BIG_ONES, 1)).toBe(1e-4)
    expect(Number.isFinite(waterGlint(1, 1, 1, 1e-4))).toBe(true)
  })
  it('α² не выше 1 — степень лепестка неотрицательна', () => {
    expect(glintAlpha2(1, [0, 0, 0, 0, 0], [0, 0, 0, 0], 10)).toBe(1)
    expect(Number.isFinite(waterGlint(0, 1, 1, 5))).toBe(true)
  })
  it('потолок, ∝ N·L, ноль при N·L ≤ 0', () => {
    expect(waterGlint(1, 1, 1, 1e-4)).toBe(WATER_GLINT_CEILING)
    expect(waterGlint(0.999, 1, 0.5, 0.01)).toBeCloseTo(0.5 * waterGlint(0.999, 1, 1, 0.01), 9)
    expect(waterGlint(1, 1, -0.1, 0.01)).toBe(0)
  })
  it('шире лепесток — ниже пик, вне пика ярче: дорожка расплывается', () => {
    expect(waterGlint(1, 1, 1, 0.01)).toBeGreaterThan(waterGlint(1, 1, 1, 0.05))
    expect(waterGlint(0.99, 1, 1, 0.05)).toBeGreaterThan(waterGlint(0.99, 1, 1, 0.01))
  })
})

describe('waterOctavesMath: поглощение', () => {
  const sigma: [number, number, number] = [0.45, 0.07, 0.03]
  it('глубина 0 — полное пропускание, слой прозрачный, цвет конечный', () => {
    const layer = absorptionLayer(waterTransmittance(0, 1, sigma), [0.04, 0.24, 0.4])
    expect(layer.alpha).toBe(0)
    expect(layer.color.every(Number.isFinite)).toBe(true)
  })
  it('красный гаснет раньше синего', () => {
    const t = waterTransmittance(5, 1, sigma)
    expect(t[0]).toBeLessThan(t[2])
  })
  it('точная формула: L = d·(1 + 1/max(μv, 0.1))', () => {
    const t1 = waterTransmittance(1, 1, sigma)
    const t0 = waterTransmittance(1, 0, sigma)
    for (let i = 0; i < 3; i++) {
      expect(t1[i]).toBeCloseTo(Math.exp(-2 * sigma[i]), 12)
      expect(t0[i]).toBeCloseTo(Math.exp(-11 * sigma[i]), 12)
    }
  })
  it('скользящий взгляд плотнее', () => {
    expect(waterTransmittance(5, 0.2, sigma)[2]).toBeLessThan(waterTransmittance(5, 1, sigma)[2])
  })
  it('вклад слоя после смешивания — C·(1 − T)', () => {
    const t = waterTransmittance(10, 1, sigma)
    const c: [number, number, number] = [0.04, 0.24, 0.4]
    const layer = absorptionLayer(t, c)
    for (let i = 0; i < 3; i++) expect(layer.color[i] * layer.alpha).toBeCloseTo(Math.min(c[i] * (1 - t[i]), layer.alpha), 9)
  })
})

describe('waterOctavesMath: замер ассета', () => {
  it('WATER_OCTAVE_SLOPE_VARIANCE совпадает с дисперсией наклона waternormals.jpg в пределах 2 %', async () => {
    const sharp = (await import('sharp')).default
    const { data, info } = await sharp('storage/images/textures/water/waternormals.jpg')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const count = info.width * info.height
    let sum = 0
    for (let i = 0; i < count; i++) {
      const nx = (2 * data[i * 3]) / 255 - 1
      const ny = (2 * data[i * 3 + 1]) / 255 - 1
      const nz = (2 * data[i * 3 + 2]) / 255 - 1
      sum += (nx * nx + ny * ny) / Math.max(nz, 0.05) ** 2
    }
    expect(Math.abs(WATER_OCTAVE_SLOPE_VARIANCE / (sum / count) - 1)).toBeLessThan(0.02)
  })
})
