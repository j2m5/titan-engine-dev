import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { bandPassSpherical } from './sphericalBandFilter'
import { percentile99Abs } from './synthHeightMap'

/**
 * Гибрид «DEM + высокочастотная деталь из bump-карты»: `h = dem + band(bump)·A`.
 *
 * Зачем. Стерео-DEM планет честен в крупном и среднем масштабе, но ниже
 * разрешения стереопары (у Меркурия — волны короче ~10–20 км) сглажен: уклон
 * на текселе падает в разы против реального тела, и терминатор выглядит
 * плоским. Bump-карта того же тела мелкую фактуру несёт (яркость ≈ рельеф),
 * но абсолютных высот не знает — брать из неё только ПОЛОСУ частот, которой
 * DEM лишён, и добавлять к честным высотам.
 *
 * Единицы: `demMeters` и `amplitudeMeters` — метры, `bumpLuminance` — [0..1],
 * границы полосы — километры длины волны на теле (переводятся в тексели
 * экватора той же формулой, что у синтеза bump-входа:
 * `σ_текселей = км·1000 / (2π·radiusMeters/width)`).
 *
 * Метод: полоса — разность размытий (`bandPassSpherical`), нормировка полосы —
 * 99-й процентиль модуля (единичный выброс яркости не сжимает типичный
 * рельеф — та же конвенция, что у `buildSynthHeightField`), амплитуда задаётся
 * флагом, а не калибруется: сколько детали добавить — решение по замеру уклона,
 * а не подгонка внутри скрипта.
 */

export interface EnhanceHeightParams {
  widthTexels: number
  heightTexels: number
  radiusMeters: number
  /** Нижняя граница полосы — длина волны, км: крупнее неё деталь не берётся (её DEM уже несёт). */
  bandLowKm: number
  /** Верхняя граница полосы — длина волны, км: мельче неё деталь не берётся (зерно и сжатие входа). */
  bandHighKm: number
  /** Амплитуда прибавки, м — значение p99 модуля полосы после нормировки. */
  amplitudeMeters: number
}

/** Uint16-тело TEHM → метры (min→0, max→65535). */
export function decodeHeightMeters(map: HeightMapData): Float64Array {
  const range = map.maxMeters - map.minMeters
  const out = new Float64Array(map.data.length)

  for (let i = 0; i < out.length; i++) out[i] = map.minMeters + (map.data[i] / 65535) * range

  return out
}

/**
 * `h = dem + band(bump)·A` и фактический min/max результата (реальный диапазон
 * данных для заголовка TEHM, не номинальный) — см. докблок модуля.
 *
 * `amplitudeMeters = 0` возвращает высоты DEM без изменений (прибавка ровно
 * ноль, не «почти ноль»); вырожденная полоса (всюду 0) — тоже.
 */
export function enhanceHeightField(
  demMeters: Float64Array,
  bumpLuminance: Float64Array,
  params: EnhanceHeightParams
): { heights: Float64Array; minMeters: number; maxMeters: number } {
  const { widthTexels: width, heightTexels: height } = params
  const texels = width * height

  if (demMeters.length !== texels) {
    throw new Error(`Гибрид высот: длина DEM не сходится с width×height (ожидалось ${texels}, получено ${demMeters.length})`)
  }
  if (bumpLuminance.length !== texels) {
    throw new Error(
      `Гибрид высот: длина bump-яркости не сходится с width×height (ожидалось ${texels}, получено ${bumpLuminance.length})`
    )
  }
  // Полоса вырождается в шум или в дубль DEM, если границы перепутаны местами —
  // отказ здесь дешевле разбора странной карты потом.
  if (!(params.bandHighKm > 0) || !(params.bandLowKm > params.bandHighKm)) {
    throw new Error(`Гибрид высот: нужна полоса bandLowKm > bandHighKm > 0, получено ${params.bandLowKm}/${params.bandHighKm}`)
  }

  const equatorTexelMeters = (2 * Math.PI * params.radiusMeters) / width
  const sigmaLowTexels = (params.bandLowKm * 1000) / equatorTexelMeters
  const sigmaHighTexels = (params.bandHighKm * 1000) / equatorTexelMeters

  const band = bandPassSpherical(bumpLuminance, width, height, sigmaLowTexels, sigmaHighTexels)
  const p99 = percentile99Abs(band)
  const scale = p99 > 0 ? params.amplitudeMeters / p99 : 0

  const heights = new Float64Array(texels)
  let minMeters = Infinity
  let maxMeters = -Infinity

  for (let i = 0; i < texels; i++) {
    const value = demMeters[i] + band[i] * scale

    heights[i] = value
    if (value < minMeters) minMeters = value
    if (value > maxMeters) maxMeters = value
  }

  return { heights, minMeters, maxMeters }
}
