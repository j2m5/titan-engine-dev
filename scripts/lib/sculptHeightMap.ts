import { bandPassSpherical } from './sphericalBandFilter'

/**
 * Скульптинг карты высот: `h' = h + band(h)·gain(sign(band))`.
 *
 * Зачем. На 8k-карте тексель — единицы км, и кромки кратеров/гребни после
 * даунсемпла DEM сглажены: вал читается как пологий бугор. Полоса длин волн
 * bandLowKm..bandHighKm (масштаб валов и террас) вычитается из самой карты
 * (`bandPassSpherical`, разность гауссиан) и добавляется обратно с усилением —
 * контраст форм растёт, новых форм не появляется (усиливается только то, что
 * в карте уже есть; штампы под запретом — см. terrain-handoff).
 *
 * Усиление знаковое: `gainConvex` для положительной полосы (кромки, гребни,
 * центральные горки — выпуклое относительно окружения), `gainConcave` для
 * отрицательной (дно, ложбины). Асимметрия поднимает кромку, не углубляя дно —
 * профиль вала заостряется, глубина кратера почти не меняется.
 *
 * Единицы: высоты в метрах, полоса в км длины волны (σ текселей =
 * км·1000/(2π·R/width) — та же формула, что у `enhanceHeightField`).
 * Полоса вычисляется по исходной карте до добавки — операция не итеративна.
 */

export interface SculptHeightParams {
  widthTexels: number
  heightTexels: number
  radiusMeters: number
  /** Нижняя граница полосы — длина волны, км: крупнее неё формы не трогаются. */
  bandLowKm: number
  /** Верхняя граница полосы — длина волны, км: мельче неё не усиливается (зерно квантования). */
  bandHighKm: number
  /** Усиление положительной полосы (выпуклое), ≥ 0; 0 — не трогать. */
  gainConvex: number
  /** Усиление отрицательной полосы (вогнутое), ≥ 0; 0 — не трогать. */
  gainConcave: number
}

/**
 * Возвращает новые высоты и их фактический min/max (для заголовка TEHM).
 * `gainConvex = gainConcave = 0` — высоты копируются без изменений.
 */
export function sculptHeightField(
  heightsMeters: Float64Array,
  params: SculptHeightParams
): { heights: Float64Array; minMeters: number; maxMeters: number } {
  const { widthTexels: width, heightTexels: height, gainConvex, gainConcave } = params
  const texels = width * height

  if (heightsMeters.length !== texels) {
    throw new Error(`Скульптинг высот: длина карты не сходится с width×height (ожидалось ${texels}, получено ${heightsMeters.length})`)
  }
  if (!(params.bandHighKm > 0) || !(params.bandLowKm > params.bandHighKm)) {
    throw new Error(`Скульптинг высот: нужна полоса bandLowKm > bandHighKm > 0, получено ${params.bandLowKm}/${params.bandHighKm}`)
  }
  if (!(gainConvex >= 0) || !(gainConcave >= 0)) {
    throw new Error(`Скульптинг высот: усиления должны быть неотрицательными, получено ${gainConvex}/${gainConcave}`)
  }

  const equatorTexelMeters = (2 * Math.PI * params.radiusMeters) / width
  const sigmaLowTexels = (params.bandLowKm * 1000) / equatorTexelMeters
  const sigmaHighTexels = (params.bandHighKm * 1000) / equatorTexelMeters

  // Полоса не считается зря при нулевых усилениях — и результат тогда точная копия.
  const band = gainConvex === 0 && gainConcave === 0
    ? null
    : bandPassSpherical(heightsMeters, width, height, sigmaLowTexels, sigmaHighTexels)

  const heights = new Float64Array(texels)
  let minMeters = Infinity
  let maxMeters = -Infinity

  for (let i = 0; i < texels; i++) {
    const b = band === null ? 0 : band[i]
    const value = heightsMeters[i] + b * (b > 0 ? gainConvex : gainConcave)

    heights[i] = value
    if (value < minMeters) minMeters = value
    if (value > maxMeters) maxMeters = value
  }

  return { heights, minMeters, maxMeters }
}
