import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { buildElevationHeightField, buildSynthHeightField, type SynthHeightParams } from './synthHeightMap'
import { normalizeToUint16 } from './heightMapEncode'
import { buildSlopeMap, SLOPE_RANGE } from './slopeMapEncode'

export interface SynthesizeResult {
  map: HeightMapData
  slopeRgb: Uint8Array
  rmsTan: number
}

/** Опции `buildSlopeMap`, пробрасываемые без изменений. */
type SlopeOptions = { cavity?: boolean; slopeRange?: number }

/**
 * RMS(tan) slope-карты — векторная величина по R(восток)/G(север); канал B
 * (полость) функция не читает вовсе, поэтому результат не зависит от того,
 * запечён ли cavity в буфере (калибровка батч-генератора зовёт
 * `synthesizeHeightAndSlope` с `{ cavity: false }` — см.
 * `batch-synth-heightmaps.ts` — но контракт этой функции этого и не
 * предполагает). Считаем прямо на буфере `buildSlopeMap` — это байт-в-байт
 * то, что дальше пишется в lossless webp, раскодировка готового файла
 * sharp'ом дала бы те же числа; лишний файловый круг во время калибровки не
 * нужен. Декод здесь захардкожен на дефолтный SLOPE_RANGE — калибровочные
 * прогоны (в отличие от финальной записи) кодируются им же, пара
 * энкод/декод остаётся согласованной.
 */
export function measureRmsTan(rgb: Uint8Array, width: number, height: number): number {
  const decode = (byte: number): number => ((byte - 128) / 127) * SLOPE_RANGE
  const count = width * height
  let sumSquares = 0

  for (let i = 0; i < count; i++) {
    const east = decode(rgb[i * 3])
    const north = decode(rgb[i * 3 + 1])
    sumSquares += east * east + north * north
  }

  return Math.sqrt(sumSquares / count)
}

/** Общий хвост обоих конвейеров: поле высот → нормировка uint16 → slope-карта → замер RMS(tan). */
function assembleSlope(
  heights: Float64Array,
  minMeters: number,
  maxMeters: number,
  width: number,
  height: number,
  radiusMeters: number,
  options?: SlopeOptions
): SynthesizeResult {
  const data = normalizeToUint16(Float32Array.from(heights), minMeters, maxMeters)
  const map: HeightMapData = { width, height, minMeters, maxMeters, data }
  const slopeRgb = buildSlopeMap(map, radiusMeters, options)

  return { map, slopeRgb, rmsTan: measureRmsTan(slopeRgb, width, height) }
}

/**
 * Тот же конвейер для ЧЕСТНОЙ карты высот (`buildElevationHeightField`):
 * подложки и полосового фильтра нет, амплитуду задаёт `peakMeters` (бюджет
 * высоты тела), поэтому ни автокалибровки по RMS, ни пост-коррекции по пику
 * вызывающему не нужно — пик равен бюджету по построению. `rmsTan` здесь
 * отчётная величина, а не цель подгонки.
 */
export function synthesizeElevationHeightAndSlope(
  luminance: Float64Array,
  width: number,
  height: number,
  radiusMeters: number,
  peakMeters: number,
  smoothSigmaTexels: number,
  options?: SlopeOptions
): SynthesizeResult {
  const { heights, minMeters, maxMeters } = buildElevationHeightField(luminance, {
    widthTexels: width,
    heightTexels: height,
    peakMeters,
    smoothSigmaTexels
  })

  return assembleSlope(heights, minMeters, maxMeters, width, height, radiusMeters, options)
}

/**
 * Один прогон конвейера: синтез поля высот → нормировка → slope-карта →
 * замер RMS(tan). `baseAmplitudeMeters` — параметр, а не константа модуля:
 * пост-коррекция по фактическому пику (см. `generateBody` в
 * `batch-synth-heightmaps.ts`) рескейлит и подложку, не только
 * bump-амплитуду.
 *
 * `options.cavity` пробрасывается в `buildSlopeMap` без изменений (дефолт
 * `true`). Калибровка батч-генератора всегда зовёт с `{ cavity: false }` —
 * `measureRmsTan` канал B не читает, а пять DoG-полос `buildCavityField`
 * дорогие (замер: Диона 29.3 с против 6.5 с на прогон с cavity выключенной),
 * платить за них на КАЖДОЙ из до 3 калибровочных итераций бессмысленно.
 */
export function synthesizeHeightAndSlope(
  luminance: Float64Array,
  width: number,
  height: number,
  radiusMeters: number,
  seed: number,
  bandLowKm: number,
  bandHighKm: number,
  baseAmplitudeMeters: number,
  bumpAmplitudeMeters: number,
  options?: SlopeOptions
): SynthesizeResult {
  const params: SynthHeightParams = {
    widthTexels: width,
    heightTexels: height,
    radiusMeters,
    seed,
    baseAmplitudeMeters,
    bumpAmplitudeMeters,
    bandLowKm,
    bandHighKm,
    bumpSign: 1,
    raw: false
  }

  const { heights, minMeters, maxMeters } = buildSynthHeightField(luminance, params)

  return assembleSlope(heights, minMeters, maxMeters, width, height, radiusMeters, options)
}
