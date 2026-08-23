import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { decodeHeightMeters, enhanceHeightField, type EnhanceHeightParams } from '../../scripts/lib/enhanceHeightMap'
import { encodeHeightMap, normalizeToUint16 } from '../../scripts/lib/heightMapEncode'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

const WIDTH = 256
const HEIGHT = 128

/**
 * Радиус, при котором 1 км трассы равен ровно одному текселю экватора
 * (σ_текселей = км·1000/(2π·R/width) → при R = 1000·width/(2π) знаменатель 1000):
 * границы полосы в км численно равны сигмам в текселях (та же уловка, что в
 * synthHeightMap.spec.ts).
 */
function radiusForOneKmPerTexel(width: number): number {
  return (1000 * width) / (2 * Math.PI)
}

/**
 * Полоса 32..4 (σ в текселях = км): по передаточной функции гауссианы
 * T(λ,σ)=exp(−2π²σ²/λ²) волна λ=64 текселя проходит с усилением ≈0.92
 * (T(64,4)=0.926 минус T(64,32)=0.007), волна λ=8 текселей — с ≈0.007.
 * Разнос в две сотни раз и делает «средняя частота проходит, мелкое зерно
 * подавлено» проверяемым числом.
 */
function baseParams(amplitudeMeters: number): EnhanceHeightParams {
  return {
    widthTexels: WIDTH,
    heightTexels: HEIGHT,
    radiusMeters: radiusForOneKmPerTexel(WIDTH),
    bandLowKm: 32,
    bandHighKm: 4,
    amplitudeMeters
  }
}

/** Волна по долготе с длиной волны `wavelengthTexels`, одинаковая во всех строках. */
function wave(wavelengthTexels: number, amplitude: number): Float64Array {
  const out = new Float64Array(WIDTH * HEIGHT)

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) out[y * WIDTH + x] = amplitude * Math.sin((2 * Math.PI * x) / wavelengthTexels)
  }

  return out
}

/** Синтетический DEM: наклонная «полосатая» карта, крайние коды 0 и 65535 присутствуют. */
function makeDem(): HeightMapData {
  const data = new Uint16Array(WIDTH * HEIGHT)

  for (let i = 0; i < data.length; i++) data[i] = (i * 977) % 65536
  data[0] = 0
  data[1] = 65535

  // Границы точно представимы во float32 — заголовок TEHM хранит их float32,
  // и round-trip обязан быть точным, иначе «байт-в-байт» проверял бы округление.
  return { width: WIDTH, height: HEIGHT, minMeters: -1000, maxMeters: 3000, data }
}

/** Коэффициент при заданной волне в экваториальной строке поля (проекция на неё). */
function componentAt(field: Float64Array, wavelengthTexels: number): number {
  const row = HEIGHT / 2
  let dot = 0
  let norm = 0

  for (let x = 0; x < WIDTH; x++) {
    const basis = Math.sin((2 * Math.PI * x) / wavelengthTexels)
    dot += field[row * WIDTH + x] * basis
    norm += basis * basis
  }

  return dot / norm
}

describe('enhanceHeightField', () => {
  it('нулевая амплитуда возвращает DEM байт-в-байт', () => {
    const dem = makeDem()
    const demMeters = decodeHeightMeters(dem)
    const bump = wave(64, 0.3)

    const { heights, minMeters, maxMeters } = enhanceHeightField(demMeters, bump, baseParams(0))

    expect(minMeters).toBe(dem.minMeters)
    expect(maxMeters).toBe(dem.maxMeters)

    const rebuilt = encodeHeightMap({
      width: WIDTH,
      height: HEIGHT,
      minMeters,
      maxMeters,
      data: normalizeToUint16(Float32Array.from(heights), minMeters, maxMeters)
    })

    expect(Buffer.compare(rebuilt, encodeHeightMap(dem))).toBe(0)
  })

  it('амплитуда масштабирует прибавку линейно', () => {
    const dem = makeDem()
    const demMeters = decodeHeightMeters(dem)
    const bump = wave(64, 0.3)

    const single = enhanceHeightField(demMeters, bump, baseParams(500)).heights
    const triple = enhanceHeightField(demMeters, bump, baseParams(1500)).heights

    for (let i = 0; i < demMeters.length; i += 137) {
      expect(triple[i] - demMeters[i]).toBeCloseTo(3 * (single[i] - demMeters[i]), 9)
    }
  })

  it('амплитуда — p99 модуля прибавки', () => {
    const dem = makeDem()
    const demMeters = decodeHeightMeters(dem)
    const bump = wave(64, 0.3)
    const amplitudeMeters = 900

    const { heights } = enhanceHeightField(demMeters, bump, baseParams(amplitudeMeters))
    const added = Float64Array.from(heights, (value, i) => Math.abs(value - demMeters[i]))
    added.sort()

    expect(added[Math.floor(0.99 * (added.length - 1))]).toBeCloseTo(amplitudeMeters, 6)
  })

  it('средняя частота проходит, мелкое зерно и константа подавлены', () => {
    const dem = makeDem()
    const demMeters = decodeHeightMeters(dem)
    const amplitudeMeters = 1000

    // Вход: константа + волна в полосе (λ=64) + зерно мельче верхней границы (λ=8).
    const bump = new Float64Array(WIDTH * HEIGHT)
    const mid = wave(64, 1)
    const fine = wave(8, 1)
    for (let i = 0; i < bump.length; i++) bump[i] = 0.5 + mid[i] + fine[i]

    const { heights } = enhanceHeightField(demMeters, bump, baseParams(amplitudeMeters))
    const added = Float64Array.from(heights, (value, i) => value - demMeters[i])

    const midCoefficient = Math.abs(componentAt(added, 64))
    const fineCoefficient = Math.abs(componentAt(added, 8))

    // Зерно ослаблено на два порядка против середины полосы (порог 5% — запас
    // на огрубление гауссианы box-триплетом, континуальная оценка ≈0.8%).
    expect(fineCoefficient).toBeLessThan(0.05 * midCoefficient)
    expect(midCoefficient).toBeGreaterThan(0.5 * amplitudeMeters)

    // Константа — DC полосы, разность блюров её вычитает: среднее прибавки в нуле.
    const mean = added.reduce((sum, value) => sum + value, 0) / added.length
    expect(Math.abs(mean)).toBeLessThan(0.01 * amplitudeMeters)
  })

  it('константный вход не даёт прибавки вовсе (вырожденная полоса — ноль, не деление на ноль)', () => {
    const dem = makeDem()
    const demMeters = decodeHeightMeters(dem)
    const bump = new Float64Array(WIDTH * HEIGHT).fill(0.5)

    const { heights } = enhanceHeightField(demMeters, bump, baseParams(1000))

    for (let i = 0; i < heights.length; i++) expect(heights[i]).toBe(demMeters[i])
  })

  it('min/max — фактические границы результата, не границы DEM', () => {
    const dem = makeDem()
    const demMeters = decodeHeightMeters(dem)
    const bump = wave(64, 0.3)

    const { heights, minMeters, maxMeters } = enhanceHeightField(demMeters, bump, baseParams(700))

    let actualMin = Infinity
    let actualMax = -Infinity
    for (const value of heights) {
      if (value < actualMin) actualMin = value
      if (value > actualMax) actualMax = value
    }

    expect(minMeters).toBe(actualMin)
    expect(maxMeters).toBe(actualMax)
    expect(minMeters).toBeLessThan(dem.minMeters)
    expect(maxMeters).toBeGreaterThan(dem.maxMeters)
  })

  it('перепутанные границы полосы и несходящиеся длины отвергаются', () => {
    const dem = makeDem()
    const demMeters = decodeHeightMeters(dem)
    const bump = wave(64, 0.3)

    expect(() => enhanceHeightField(demMeters, bump, { ...baseParams(500), bandLowKm: 2 })).toThrow(/полоса/)
    expect(() => enhanceHeightField(demMeters, bump, { ...baseParams(500), bandHighKm: 0 })).toThrow(/полоса/)
    expect(() => enhanceHeightField(new Float64Array(4), bump, baseParams(500))).toThrow(/DEM/)
    expect(() => enhanceHeightField(demMeters, new Float64Array(4), baseParams(500))).toThrow(/bump/)
  })
})

describe('decodeHeightMeters', () => {
  it('крайние коды дают границы диапазона, середина — середину', () => {
    const map: HeightMapData = {
      width: 2,
      height: 2,
      minMeters: -1000,
      maxMeters: 3000,
      data: new Uint16Array([0, 65535, 32767, 32768])
    }

    const meters = decodeHeightMeters(map)

    expect(meters[0]).toBe(-1000)
    expect(meters[1]).toBe(3000)
    expect(meters[2]).toBeCloseTo(999.97, 2)
    expect(meters[3]).toBeCloseTo(1000.03, 2)
  })
})
