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
 *
 * `normalizeBelt` меняет ОБЛАСТЬ нормировки, а не саму полосу: p99 считается
 * только по экваториальному поясу |lat| < 30°. У эквиректангулярных входов
 * полюса растянуты проекцией и несут швы мозаики — их значения задают
 * глобальный p99, и на экваторе прибавка выходит в разы слабее номинала
 * (замер по Меркурию: |Δh| p90 254 м в поясе против 814 м за 60°). Полюсам при
 * этом достаётся больше номинала — это цена решения, а не побочный дефект.
 */

/** Граница пояса нормировки, градусы широты. */
const NORM_BELT_LATITUDE_DEG = 30

/** Широта центра строки, радианы: y=0 — север (полутексельная конвенция карт). */
function rowLatitude(y: number, height: number): number {
  return Math.PI / 2 - ((y + 0.5) / height) * Math.PI
}

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
  /** Нормировать полосу по p99 экваториального пояса |lat| < 30° вместо всей карты (см. докблок модуля). */
  normalizeBelt?: boolean
}

/** p99 модуля полосы в строках пояса |lat| < NORM_BELT_LATITUDE_DEG. */
function beltPercentile99Abs(band: Float64Array, width: number, height: number): number {
  const limit = (NORM_BELT_LATITUDE_DEG * Math.PI) / 180
  const rows: number[] = []

  for (let y = 0; y < height; y++) if (Math.abs(rowLatitude(y, height)) < limit) rows.push(y)

  // Карта в одну-две строки может не иметь ни одной строки пояса — тогда
  // нормировать нечем, и честный ответ «полоса вырождена», а не деление на ноль.
  if (rows.length === 0) return 0

  const belt = new Float64Array(rows.length * width)
  for (let i = 0; i < rows.length; i++) belt.set(band.subarray(rows[i] * width, rows[i] * width + width), i * width)

  return percentile99Abs(belt)
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
  const p99 = params.normalizeBelt ? beltPercentile99Abs(band, width, height) : percentile99Abs(band)
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
