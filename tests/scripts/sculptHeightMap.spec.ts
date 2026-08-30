import { describe, expect, it } from 'vitest'
import { sculptHeightField, type SculptHeightParams } from '../../scripts/lib/sculptHeightMap'

const WIDTH = 256
const HEIGHT = 128

/** Радиус, при котором 1 км = 1 тексель экватора: границы полосы в км равны σ в текселях (как в enhanceHeightMap.spec). */
function radiusForOneKmPerTexel(width: number): number {
  return (1000 * width) / (2 * Math.PI)
}

/**
 * Полоса 32..4: волна λ=64 текселя проходит с передачей ≈0.92
 * (T(64,4)−T(64,32) = 0.926−0.007), волна λ=8 — с ≈0.007 (см. enhanceHeightMap.spec).
 */
function baseParams(gainConvex: number, gainConcave: number): SculptHeightParams {
  return {
    widthTexels: WIDTH,
    heightTexels: HEIGHT,
    radiusMeters: radiusForOneKmPerTexel(WIDTH),
    bandLowKm: 32,
    bandHighKm: 4,
    gainConvex,
    gainConcave
  }
}

function wave(wavelengthTexels: number, amplitude: number, offset = 0): Float64Array {
  const out = new Float64Array(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) out[y * WIDTH + x] = offset + amplitude * Math.sin((2 * Math.PI * x) / wavelengthTexels)
  }
  return out
}

/** Экваториальная строка — там σ EW-прохода не растянут широтой. */
const EQUATOR_ROW = HEIGHT / 2
const PEAK_X = 16 // sin(2π·16/64) = 1
const TROUGH_X = 48 // sin(2π·48/64) = −1

describe('sculptHeightField', () => {
  it('нулевые усиления возвращают высоты без изменений и честный min/max', () => {
    const src = wave(64, 500, 1000)
    const { heights, minMeters, maxMeters } = sculptHeightField(src, baseParams(0, 0))

    expect(heights).not.toBe(src)
    for (let i = 0; i < src.length; i++) expect(heights[i]).toBe(src[i])
    expect(minMeters).toBeCloseTo(500, 6)
    expect(maxMeters).toBeCloseTo(1500, 6)
  })

  it('симметричное усиление 1 почти удваивает волну полосы и не трогает мелкое зерно', () => {
    const passing = sculptHeightField(wave(64, 100), baseParams(1, 1)).heights
    const grain = sculptHeightField(wave(8, 100), baseParams(1, 1)).heights

    const peak = passing[EQUATOR_ROW * WIDTH + PEAK_X]
    const trough = passing[EQUATOR_ROW * WIDTH + TROUGH_X]
    expect(peak).toBeGreaterThan(180)
    expect(peak).toBeLessThan(200)
    expect(trough).toBeLessThan(-180)
    expect(trough).toBeGreaterThan(-200)

    // λ=8 (2 текселя на гребень, sin(2π·2/8)=1) — усиление в пределах единиц процентов
    const grainPeak = grain[EQUATOR_ROW * WIDTH + 2]
    expect(grainPeak).toBeGreaterThan(99)
    expect(grainPeak).toBeLessThan(105)
  })

  it('асимметричное усиление поднимает выпуклое и оставляет вогнутое (кромка растёт, дно стоит)', () => {
    const { heights } = sculptHeightField(wave(64, 100), baseParams(1, 0))

    const peak = heights[EQUATOR_ROW * WIDTH + PEAK_X]
    const trough = heights[EQUATOR_ROW * WIDTH + TROUGH_X]
    expect(peak).toBeGreaterThan(180)
    expect(trough).toBeCloseTo(-100, 6)
  })

  it('выпуклость определяется полосой, а не абсолютной высотой: смещённая волна ведёт себя так же', () => {
    const plain = sculptHeightField(wave(64, 100), baseParams(1, 0)).heights
    const lifted = sculptHeightField(wave(64, 100, -5000), baseParams(1, 0)).heights

    for (const x of [PEAK_X, TROUGH_X]) {
      const i = EQUATOR_ROW * WIDTH + x
      expect(lifted[i] + 5000).toBeCloseTo(plain[i], 6)
    }
  })

  it('отказывает на несовпадении длины и на перепутанной полосе', () => {
    expect(() => sculptHeightField(new Float64Array(10), baseParams(1, 1))).toThrow(/длина/)
    expect(() => sculptHeightField(wave(64, 1), { ...baseParams(1, 1), bandLowKm: 4, bandHighKm: 32 })).toThrow(/полоса/)
    expect(() => sculptHeightField(wave(64, 1), { ...baseParams(-1, 1) })).toThrow(/усилени/)
  })
})
