import { bandPassSpherical } from './sphericalBandFilter'
import { synthBaseField } from './synthNoise'

export interface SynthHeightParams {
  widthTexels: number
  heightTexels: number
  radiusMeters: number
  seed: number
  baseAmplitudeMeters: number
  bumpAmplitudeMeters: number
  bandLowKm: number
  bandHighKm: number
  bumpSign: 1 | -1
  raw: boolean
}

/** Октав подложки и её базовая волна — см. докблок ниже (λ0 = четверть окружности тела). */
const BASE_FIELD_OCTAVES = 3
const BASE_FIELD_WAVE_FRACTION = 4 // λ0 = окружность / 4

/** 99-й процентиль |values| (не мутирует вход) — «выброс не сжимает рельеф»: топ-1% исключён из нормировки. */
function percentile99Abs(values: Float64Array): number {
  const abs = Float64Array.from(values, (v) => Math.abs(v))
  abs.sort()
  const idx = Math.floor(0.99 * (abs.length - 1))

  return abs[idx]
}

/**
 * Направление текселя (x,y) эквиректангулярной карты — обратная развёртка
 * SphereGeometry (см. докблок `TerrainHeightField.dirToUv`, зеркально):
 * u=(x+0.5)/width, v=(y+0.5)/height (полутекселные центры, строка 0 — север),
 * θ=π·v, φ=2π·u, x=−cos(φ)·sinθ, y=cosθ, z=sin(φ)·sinθ.
 */
function texelDirection(x: number, y: number, width: number, height: number): [number, number, number] {
  const u = (x + 0.5) / width
  const v = (y + 0.5) / height
  const theta = Math.PI * v
  const phi = 2 * Math.PI * u
  const sinTheta = Math.sin(theta)

  return [-Math.cos(phi) * sinTheta, Math.cos(theta), Math.sin(phi) * sinTheta]
}

/**
 * Сборка поля высот тела из bump-яркости: `h = подложка(dir̂) + band(bump)·амплитуда`.
 *
 * Полосовой фильтр (`bandPassSpherical`, Task 1) вырезает средние частоты
 * bump-карты (диапазон `bandLowKm..bandHighKm`, км волны на теле; переводятся
 * в тексели экватора формулой `σ_текселей = км·1000 / (2π·radiusMeters/width)`
 * — длина экваториальной дуги на тексель в знаменателе). Результат
 * нормируется по 99-му процентилю МОДУЛЯ (не max — единичный выброс яркости
 * не сжимает типичный рельеф, см. тест p99-нормировки), домножается на
 * `bumpAmplitudeMeters` и знак `bumpSign`.
 *
 * Подложка — `synthBaseField` (3 октавы, волна λ0 = четверть окружности тела:
 * `baseFrequency = 2π/λ0 = 4` на единичной сфере, т.к. λ0=circumference/4=π/2
 * при circumference=2π) на направлении текселя, домноженная на
 * `baseAmplitudeMeters`; сид подложки — `seed` без смещения (смещение по
 * октавам — внутри `synthBaseField`).
 *
 * `raw=true` — отладочный обход band и подложки: высоты = яркость ×
 * bumpAmplitudeMeters × bumpSign, байт-в-байт (используется для сверки
 * калибровки амплитуды по сырому bump без фильтрации).
 *
 * Возвращает поле высот в метрах и фактический min/max (для заголовка TEHM —
 * реальный диапазон данных, не номинальный).
 */
export function buildSynthHeightField(
  bumpLuminance: Float64Array,
  params: SynthHeightParams
): { heights: Float64Array; minMeters: number; maxMeters: number } {
  const { widthTexels: width, heightTexels: height } = params

  if (bumpLuminance.length !== width * height) {
    throw new Error(
      `Синтез карты высот: длина bump-яркости не сходится с width×height (ожидалось ${width * height}, получено ${bumpLuminance.length})`
    )
  }

  const heights = new Float64Array(width * height)

  if (params.raw) {
    for (let i = 0; i < heights.length; i++) {
      heights[i] = bumpLuminance[i] * params.bumpAmplitudeMeters * params.bumpSign
    }
  } else {
    const equatorTexelMeters = (2 * Math.PI * params.radiusMeters) / width
    const sigmaLowTexels = (params.bandLowKm * 1000) / equatorTexelMeters
    const sigmaHighTexels = (params.bandHighKm * 1000) / equatorTexelMeters

    const band = bandPassSpherical(bumpLuminance, width, height, sigmaLowTexels, sigmaHighTexels)
    const p99 = percentile99Abs(band)
    const normalizer = p99 > 0 ? 1 / p99 : 0

    const baseFrequency = BASE_FIELD_WAVE_FRACTION

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const [dirX, dirY, dirZ] = texelDirection(x, y, width, height)
        const base = synthBaseField(dirX, dirY, dirZ, params.seed, BASE_FIELD_OCTAVES, baseFrequency)
        const bump = band[i] * normalizer * params.bumpAmplitudeMeters * params.bumpSign

        heights[i] = base * params.baseAmplitudeMeters + bump
      }
    }
  }

  let minMeters = Infinity
  let maxMeters = -Infinity
  for (const h of heights) {
    if (h < minMeters) minMeters = h
    if (h > maxMeters) maxMeters = h
  }

  return { heights, minMeters, maxMeters }
}
