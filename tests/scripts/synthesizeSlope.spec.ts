import { describe, expect, it } from 'vitest'
import {
  measureRmsTan,
  synthesizeElevationHeightAndSlope,
  synthesizeHeightAndSlope
} from '../../scripts/lib/synthesizeSlope'

/**
 * Радиус подобран так, что 1 км трассы ровно равен 1 текселю экватора (тот
 * же приём, что и в synthHeightMap.spec.ts) — упрощает подбор band-low/high.
 */
function radiusForOneKmPerTexel(width: number): number {
  return (1000 * width) / (2 * Math.PI)
}

describe('synthesizeHeightAndSlope: cavity фикс-волны 3 (находка 1)', () => {
  // 128×64 — достаточно текселей для нетривиального (не всюду плоского) поля
  // после полосового фильтра и для DoG-полос buildCavityField (до σ=32), но
  // маленькое разрешение держит прогон быстрым.
  const width = 128
  const height = 64
  const radiusMeters = radiusForOneKmPerTexel(width)
  const seed = 7
  const bandLowKm = 16
  const bandHighKm = 0.5
  const baseAmplitudeMeters = 200
  const bumpAmplitudeMeters = 1000

  // Не флэт: полосовой фильтр рельефа нуждается в структуре во входной
  // яркости, иначе высоты (и полость, и R/G) выродятся в константу.
  const luminance = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      luminance[y * width + x] = 0.5 + 0.4 * Math.sin((2 * Math.PI * x) / 9) * Math.cos((2 * Math.PI * y) / 7)
    }
  }

  function run(cavity?: boolean) {
    return synthesizeHeightAndSlope(
      luminance,
      width,
      height,
      radiusMeters,
      seed,
      bandLowKm,
      bandHighKm,
      baseAmplitudeMeters,
      bumpAmplitudeMeters,
      cavity === undefined ? undefined : { cavity }
    )
  }

  it('калибровка не зависит от cavity: rmsTan байт-в-байт одинаков с { cavity: false } и дефолтом', () => {
    // Оба прогона синтезируют ОДНО И ТО ЖЕ поле высот (одинаковые seed/params)
    // — buildSlopeMap считает R/G из карты высот независимо от cavity, канал B
    // на них не влияет. rmsTan читает только R/G (см. докблок measureRmsTan) —
    // точное равенство, не допуск.
    const withCavity = run(true)
    const withoutCavity = run(false)

    expect(withCavity.rmsTan).toBe(withoutCavity.rmsTan)
  })

  it('{ cavity: false } (калибровочный/промежуточный вызов): канал B нулевой на всей карте', () => {
    const { slopeRgb } = run(false)

    for (let i = 2; i < slopeRgb.length; i += 3) expect(slopeRgb[i]).toBe(0)
  })

  it('финальный проход (дефолт, cavity: true) — канал B непустой: полость реально запечена', () => {
    const { slopeRgb } = run(undefined)

    let hasNonZeroB = false
    for (let i = 2; i < slopeRgb.length; i += 3) {
      if (slopeRgb[i] !== 0) {
        hasNonZeroB = true
        break
      }
    }

    expect(hasNonZeroB).toBe(true)
  })
})

describe('synthesizeElevationHeightAndSlope: вход-карта высот', () => {
  const width = 128
  const height = 64
  const radiusMeters = radiusForOneKmPerTexel(width)
  const peakMeters = 8318 // 0.7% радиуса Плутона — тот же бюджет, что в батче
  const smoothSigmaTexels = 0.7

  const luminance = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      luminance[y * width + x] = 0.5 + 0.4 * Math.sin((2 * Math.PI * x) / 9) * Math.cos((2 * Math.PI * y) / 7)
    }
  }

  function run(options?: { cavity?: boolean }) {
    return synthesizeElevationHeightAndSlope(
      luminance,
      width,
      height,
      radiusMeters,
      peakMeters,
      smoothSigmaTexels,
      undefined,
      options
    )
  }

  it('RMS(tan) > 0 и пик карты равен бюджету высоты', () => {
    const { map, rmsTan } = run({ cavity: false })

    expect(rmsTan).toBeGreaterThan(0)
    expect(Math.max(Math.abs(map.minMeters), Math.abs(map.maxMeters))).toBeCloseTo(peakMeters, 6)
  })

  it('детерминизм: байты slope-карты совпадают между прогонами', () => {
    expect(Array.from(run({ cavity: false }).slopeRgb)).toEqual(Array.from(run({ cavity: false }).slopeRgb))
  })

  it('{ cavity: false } не меняет R/G и обнуляет B (полость — отдельный канал)', () => {
    const withCavity = run({ cavity: true }).slopeRgb
    const withoutCavity = run({ cavity: false }).slopeRgb

    for (let i = 0; i < withCavity.length; i += 3) {
      expect(withoutCavity[i]).toBe(withCavity[i])
      expect(withoutCavity[i + 1]).toBe(withCavity[i + 1])
      expect(withoutCavity[i + 2]).toBe(0)
    }
  })

  it('highPassSigmaTexels пробрасывается в buildElevationHeightField (заданный фильтр меняет карту)', () => {
    const withoutFilter = run({ cavity: false })
    const withFilter = synthesizeElevationHeightAndSlope(
      luminance,
      width,
      height,
      radiusMeters,
      peakMeters,
      smoothSigmaTexels,
      8,
      { cavity: false }
    )

    expect(Array.from(withFilter.map.data)).not.toEqual(Array.from(withoutFilter.map.data))
  })
})

describe('measureRmsTan: не читает канал B (докблок больше не утверждает «B всегда ноль»)', () => {
  it('результат идентичен для одинаковых R/G при разном содержимом B', () => {
    const width = 2
    const height = 2
    const rgbZeroB = Uint8Array.from([140, 90, 0, 200, 40, 0, 10, 250, 0, 128, 128, 0])
    const rgbNonZeroB = Uint8Array.from(rgbZeroB)
    for (let i = 2; i < rgbNonZeroB.length; i += 3) rgbNonZeroB[i] = 255 // максимальный гребень на каждом текселе

    expect(measureRmsTan(rgbNonZeroB, width, height)).toBe(measureRmsTan(rgbZeroB, width, height))
  })
})
