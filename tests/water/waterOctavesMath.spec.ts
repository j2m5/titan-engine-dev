import { describe, expect, it } from 'vitest'
import {
  WATER_DETAIL_WRAP_METERS, WATER_GLINT_CEILING, WATER_OCTAVE_SLOPE_VARIANCE, WATER_RIPPLE_PERIODS_METERS,
  absorptionLayer, footprintMeters, glintAlpha2, octaveWeight, rippleSpeedMps, waterGlint, waterTransmittance
} from '@/core/materials/shaders/lib/chunks/waterOctavesMath'

describe('waterOctavesMath: октавы', () => {
  it('каждый период мелкой октавы делит обёртку домена — иначе шов на границе патчей', () => {
    for (const p of WATER_RIPPLE_PERIODS_METERS) expect(WATER_DETAIL_WRAP_METERS % p).toBe(0)
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
  it('шероховатость растёт ровно на дисперсию погасших октав', () => {
    const a = glintAlpha2(0.02, [1, 1, 1], 1)
    const b = glintAlpha2(0.02, [1, 0, 0.5], 1)
    expect(a).toBeCloseTo(0.02 ** 2, 12)
    expect(b - a).toBeCloseTo(1.5 * WATER_OCTAVE_SLOPE_VARIANCE, 12)
  })
  it('α² не ниже пола — степень конечна, блик без NaN', () => {
    expect(glintAlpha2(1e-6, [1], 1)).toBe(1e-4)
    expect(Number.isFinite(waterGlint(1, 1, 1, 1e-4))).toBe(true)
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
