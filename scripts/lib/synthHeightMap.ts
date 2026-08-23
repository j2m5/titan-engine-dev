import { bandPassSpherical, blurSpherical, gaussianBlurSpherical } from './sphericalBandFilter'
import { synthBaseField } from './synthNoise'

export interface ElevationHeightParams {
  widthTexels: number
  heightTexels: number
  /** Пик поля |h| после нормировки, м — бюджет высоты тела (0.7% радиуса). */
  peakMeters: number
  /** σ сглаживания в текселях ВЫХОДНОГО разрешения; 0 — без сглаживания. */
  smoothSigmaTexels: number
  /**
   * σ высокочастотного фильтра, тексели экватора — вычитает крупномасштабный
   * тренд (`h ← h − blur_σ(h)`, box-триплет `blurSpherical`) перед нормировкой
   * по пику; undefined — без фильтра, поле не меняется (см. докблок функции).
   */
  highPassSigmaTexels?: number
  /**
   * Квантиль |h|, который нормировка ставит на `peakMeters` (0.9..1);
   * undefined или 1 — прежнее поведение (максимум модуля, без клампа, байт-в-байт).
   * p < 1 отдаёт масштаб типичному рельефу, а не редким выбросам — превышение
   * клампится в ±`peakMeters` (см. докблок функции).
   */
  peakPercentile?: number
}

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

/** p-й процентиль |values| (не мутирует вход, p∈[0,1]) — топ-(1−p) исключён из результата. */
function percentileAbs(values: Float64Array, p: number): number {
  const abs = Float64Array.from(values, (v) => Math.abs(v))
  abs.sort()
  const idx = Math.floor(p * (abs.length - 1))

  return abs[idx]
}

/** 99-й процентиль |values| — «выброс не сжимает рельеф»: топ-1% исключён из нормировки. */
function percentile99Abs(values: Float64Array): number {
  return percentileAbs(values, 0.99)
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

/** Фактический min/max поля — реальный диапазон данных для заголовка TEHM. */
function rangeOf(heights: Float64Array): { minMeters: number; maxMeters: number } {
  let minMeters = Infinity
  let maxMeters = -Infinity

  for (const h of heights) {
    if (h < minMeters) minMeters = h
    if (h > maxMeters) maxMeters = h
  }

  return { minMeters, maxMeters }
}

/**
 * Сборка поля высот из ЧЕСТНОЙ карты высот (яркость = высота, а не альбедо):
 * `h = сглаживание(яркость − среднее)`, опционально высокочастотный фильтр,
 * затем нормировка по пику до `peakMeters`. Ни подложки-шума, ни двухстороннего
 * полосового фильтра bump-входа — рельеф уже есть во входе, дорисовывать
 * нечего.
 *
 * Вычитание среднего убирает произвольный уровень входа (нулевая высота =
 * средний уровень тела), нормировка по МАКСИМУМУ модуля (а не p99, как у
 * bump-синтеза) ставит самую высокую/глубокую точку ровно на бюджет высоты:
 * калибровка по RMS не нужна — амплитуду задаёт бюджет, а не подгонка.
 *
 * Сглаживание (`gaussianBlurSpherical`, σ = `smoothSigmaTexels` текселей
 * экватора) режет 8-битные ступеньки входа — 255 уровней на весь размах дают
 * заметные террасы в производной (slope-карта считается разностями соседей),
 * — и НЕ дорисовывает рельеф: σ суб-текселная.
 *
 * Высокочастотный фильтр (`highPassSigmaTexels`, опционален, ручка владельца
 * на тело) вычитает крупномасштабный тренд: `h ← h − blur_σ(h)`, блюр —
 * box-триплет `blurSpherical` (σ здесь на порядки крупнее сглаживания выше —
 * сотни текселей, точное ядро `gaussianBlurSpherical` было бы неприемлемо
 * медленным). Нужен, когда во входе много энергии на масштабах шире нужного
 * рельефа (широкие светлые/тёмные пятна альбедо честной карты высот) — без
 * фильтра нормировка по пику отдаёт им большую часть бюджета высоты, и
 * мелкие формы (кратеры, борозды) остаются плоскими. Применяется ПОСЛЕ
 * сглаживания и ДО нормировки — разнесение масштабов (суб-тексельное
 * сглаживание против сотен текселей фильтра) делает порядок двух шагов
 * практически неотличимым.
 *
 * Пик нормировки — квантиль `peakPercentile` (по умолчанию 1 — максимум
 * модуля, прежнее поведение БЕЗ клампа: сам максимум и становится
 * `peakMeters`, превышать нечему). `peakPercentile < 1` — те же данные, но
 * единичные выбросы (считанные тексели, шум скана/сшивки) не задают масштаб
 * всей карты: квантиль исключает верхний хвост из нормировки, а тексели,
 * которые в него не попали, клампятся в `±peakMeters` ПОСЛЕ масштабирования.
 * Клампится вычислимо редко (доля `1−peakPercentile` текселей) — иначе честная
 * деталь (не выброс) осталась бы плоской там, где выброс отъедал весь бюджет.
 *
 * Вырожденный вход (поле после фильтрации всюду 0) даёт нулевые высоты, а не
 * деление на ноль.
 */
export function buildElevationHeightField(
  luminance: Float64Array,
  params: ElevationHeightParams
): { heights: Float64Array; minMeters: number; maxMeters: number } {
  const { widthTexels: width, heightTexels: height } = params

  if (luminance.length !== width * height) {
    throw new Error(
      `Карта высот: длина яркости не сходится с width×height (ожидалось ${width * height}, получено ${luminance.length})`
    )
  }

  let sum = 0
  for (const value of luminance) sum += value
  const mean = sum / luminance.length

  const centered = new Float64Array(luminance.length)
  for (let i = 0; i < centered.length; i++) centered[i] = luminance[i] - mean

  const smoothed =
    params.smoothSigmaTexels > 0 ? gaussianBlurSpherical(centered, width, height, params.smoothSigmaTexels) : centered

  let highPassed = smoothed
  if (params.highPassSigmaTexels !== undefined && params.highPassSigmaTexels > 0) {
    const trend = blurSpherical(smoothed, width, height, params.highPassSigmaTexels)
    highPassed = new Float64Array(smoothed.length)
    for (let i = 0; i < highPassed.length; i++) highPassed[i] = smoothed[i] - trend[i]
  }

  const peakPercentile = params.peakPercentile ?? 1
  const peak = percentileAbs(highPassed, peakPercentile)
  const scale = peak > 0 ? params.peakMeters / peak : 0

  // Кламп — только когда p<1 реально может что-то отсечь: при p=1 (или
  // undefined) peak — точный максимум модуля, превысить его после масштаба
  // нечему, а клампить единственный кандидат означало бы рисковать
  // байт-в-байт совместимостью на округлении x·(c/x) вокруг c.
  const clampEnabled = peakPercentile < 1
  const heights = new Float64Array(highPassed.length)
  for (let i = 0; i < heights.length; i++) {
    const scaled = highPassed[i] * scale
    heights[i] = clampEnabled ? Math.min(params.peakMeters, Math.max(-params.peakMeters, scaled)) : scaled
  }

  return { heights, ...rangeOf(heights) }
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

  return { heights, ...rangeOf(heights) }
}
