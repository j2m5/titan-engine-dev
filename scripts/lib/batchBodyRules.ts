import type { Buffer } from 'node:buffer'

/**
 * Чистые правила батч-оркестратора `scripts/batch-synth-heightmaps.ts`
 * (арка synth-heightmap, батч-перевод спутников), вынесенные в отдельный
 * тестируемый модуль — сам батч-скрипт top-level await'ит `run()` и не
 * поддаётся юнит-импорту без побочного запуска всего конвейера.
 */

/** band-low по умолчанию, км — переопределяется половиной окружности у малых тел (см. `bandLowKmFor`). */
export const BAND_LOW_KM_DEFAULT = 1500

/** Верхняя граница явного потолка — размер самых крупных входов (16k). */
const RESOLUTION_OVERRIDE_MAX = 16384

/**
 * Потолок разрешения по радиусу тела — Global Constraints плана арки; выход =
 * min(источник, потолок). `override` перебивает правило по радиусу: потолок
 * задают ДАННЫЕ, когда вход честнее обычного (карта высот вместо диффуза), а
 * не только размер тела. Валидируется как степень двойки ≤ 16384 — иначе
 * даунсемпл 2:1 перестанет быть точной двоичной дробью, а VRAM slope-карты
 * уйдёт за бюджет незаметно.
 */
export function resolutionCeiling(radiusMeters: number, override?: number): number {
  if (override !== undefined) {
    const isPowerOfTwo = Number.isInteger(override) && override > 0 && (override & (override - 1)) === 0

    if (!isPowerOfTwo || override > RESOLUTION_OVERRIDE_MAX) {
      throw new Error(`Потолок разрешения должен быть степенью двойки ≤ ${RESOLUTION_OVERRIDE_MAX}, получено ${override}`)
    }

    return override
  }

  const radiusKm = radiusMeters / 1000

  if (radiusKm >= 1500) return 8192
  if (radiusKm >= 500) return 4096

  return 2048
}

/** band-low: 1500 км по умолчанию, либо половина окружности тела, если тело мельче. */
export function bandLowKmFor(radiusMeters: number): number {
  const halfCircumferenceKm = (Math.PI * radiusMeters) / 1000

  return Math.min(BAND_LOW_KM_DEFAULT, halfCircumferenceKm)
}

/** Кламп бюджета высоты — доля радиуса тела (0.7%), та же, что у калиброванных тел. */
const HEIGHT_BUDGET_FRACTION = 0.007

/**
 * Пик высоты для входа `elevation`: явный `override` (ручка владельца на
 * тело) либо бюджет `HEIGHT_BUDGET_FRACTION·radiusMeters` по умолчанию
 * (Плутон — без override, поведение не меняется). `override` должен быть
 * в (0, бюджет] — выше бюджета `buildElevationHeightField` дал бы пик
 * больше кламп-порога остальных тел батча незаметно для отчёта.
 */
export function elevationPeakMeters(radiusMeters: number, override?: number): number {
  const budgetMeters = HEIGHT_BUDGET_FRACTION * radiusMeters

  if (override === undefined) return budgetMeters

  if (!(override > 0) || override > budgetMeters) {
    throw new Error(`peakMeters должен быть в (0, ${budgetMeters.toFixed(0)}] м (бюджет 0.7% радиуса), получено ${override}`)
  }

  return override
}

/**
 * σ высокочастотного фильтра входа `elevation`, тексели экватора — из ручки
 * владельца `highPassKm` (км волны на теле), той же формулой перевода
 * км→тексели, что и края band-фильтра bump-входа (`buildSynthHeightField`):
 * `σ_текселей = highPassKm·1000 / equatorTexelMeters`. Без ручки — undefined
 * (фильтр не применяется, большинство тел не меняются). `highPassKm` обязан
 * быть > 0 — ноль или отрицательное значение бессмысленны как масштаб волны.
 */
export function elevationHighPassSigmaTexels(equatorTexelMeters: number, highPassKm?: number): number | undefined {
  if (highPassKm === undefined) return undefined

  if (!(highPassKm > 0)) throw new Error(`highPassKm должен быть > 0, получено ${highPassKm}`)

  return (highPassKm * 1000) / equatorTexelMeters
}

/** Диапазон ручки квантиля нормировки пика — ниже 0.9 отсекается уже значимая доля рельефа, не только редкий выброс. */
const PEAK_PERCENTILE_MIN = 0.9
const PEAK_PERCENTILE_MAX = 1

/**
 * Квантиль |h| нормировки пика входа `elevation` — явный `override` (ручка
 * владельца на тело, редкие выбросы яркости не должны диктовать масштаб всей
 * карты) либо дефолт 1 (максимум модуля, прежнее поведение — большинство тел
 * не меняются). `override` обязан быть в [0.9, 1].
 */
export function elevationPeakPercentile(override?: number): number {
  if (override === undefined) return 1

  if (override < PEAK_PERCENTILE_MIN || override > PEAK_PERCENTILE_MAX) {
    throw new Error(`peakPercentile должен быть в [${PEAK_PERCENTILE_MIN}, ${PEAK_PERCENTILE_MAX}], получено ${override}`)
  }

  return override
}

/** Потолок ручки σ сглаживания входа `elevation` — выше уже не срез 8-битных ступенек, а размытие рельефа. */
const ELEVATION_SMOOTH_SIGMA_MAX = 4

/**
 * σ сглаживания входа `elevation`, тексели выхода: явный `override` (ручка
 * владельца на тело — зернистый вход требует сильнее дефолта) либо
 * `defaultSigmaTexels` (0.7 в батче, см. `ELEVATION_SMOOTH_SIGMA_TEXELS`,
 * Плутон и Европа без override не меняются). `override` должен быть в
 * (0, 4] — выше это уже не де-квантование 8-битных ступенек, а размытие
 * самого рельефа.
 */
export function elevationSmoothSigmaTexels(defaultSigmaTexels: number, override?: number): number {
  if (override === undefined) return defaultSigmaTexels

  if (!(override > 0) || override > ELEVATION_SMOOTH_SIGMA_MAX) {
    throw new Error(`smoothSigmaTexels должен быть в (0, ${ELEVATION_SMOOTH_SIGMA_MAX}], получено ${override}`)
  }

  return override
}

/** Веса area-average по одной оси: для каждого выходного индекса — список (исходный индекс, доля перекрытия окна). */
interface AxisWeight {
  index: number
  weight: number
}

/**
 * Раскладка весов area-average по одной оси. Скейл (`sourceSize/targetSize`)
 * НЕ обязан быть целым — окно выходного пикселя `[t·scale, (t+1)·scale)`
 * пересекается с исходными пикселями по дробному перекрытию; для целого
 * скейла веса вырождаются в 1 внутри блока и 0 снаружи (старое block-average
 * поведение как частный случай).
 */
function axisWeights(sourceSize: number, targetSize: number): AxisWeight[][] {
  const scale = sourceSize / targetSize
  const weights: AxisWeight[][] = []

  for (let t = 0; t < targetSize; t++) {
    const start = t * scale
    const end = start + scale
    const row: AxisWeight[] = []

    for (let i = Math.floor(start); i < Math.min(Math.ceil(end), sourceSize); i++) {
      const overlap = Math.min(end, i + 1) - Math.max(start, i)
      if (overlap > 0) row.push({ index: i, weight: overlap })
    }

    weights.push(row)
  }

  return weights
}

/**
 * Area-average (box) даунсемпл яркости [0..1] до произвольного (не только
 * кратного целого) коэффициента уменьшения. НЕ через sharp `.resize` —
 * установленная версия sharp не экспонирует box-кернел (`sharp.kernel` даёт
 * только nearest/linear/cubic/mitchell/lanczos2/lanczos3/mks2013/mks2021, без
 * box); `resampleDem.ts` заточен под float DEM другого конвейера (lanczos3,
 * `.raw({depth:'float'})`) — копировать нечего, кернел там для другой задачи.
 *
 * Потолки разрешения батча (`resolutionCeiling`) не всегда делят реальные
 * размеры входов нацело (напр. Мимас 6356×3178 → потолок 2048 без остатка
 * не делится) — раскладка через `axisWeights` считает честное дробное
 * перекрытие, а не молчаливо округляет коэффициент до ближайшего целого.
 *
 * Носитель выходного пикселя ⊂ [0, S) по каждой оси (`axisWeights` клампит
 * верхний индекс до `sourceSize`) — фильтр никогда не выходит за пределы
 * строки/столбца, wrap долготы (лево-право карты) и кламп широты не нужны.
 * При 2:1 входе и целевой ширине-степени-двойки скейл — точная двоичная
 * дробь (степень двойки делённая на степень двойки), fp-дрейфа в границах
 * окон не накапливается.
 */
export function boxDownsampleGreyscale(
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Float64Array {
  const colWeights = axisWeights(sourceWidth, targetWidth)
  const rowWeights = axisWeights(sourceHeight, targetHeight)
  const scaleArea = (sourceWidth / targetWidth) * (sourceHeight / targetHeight)
  const out = new Float64Array(targetWidth * targetHeight)

  for (let ty = 0; ty < targetHeight; ty++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      let sum = 0

      for (const { index: ry, weight: wy } of rowWeights[ty]) {
        const rowOffset = ry * sourceWidth
        for (const { index: cx, weight: wx } of colWeights[tx]) sum += source[rowOffset + cx] * wy * wx
      }

      out[ty * targetWidth + tx] = sum / (scaleArea * 255)
    }
  }

  return out
}
