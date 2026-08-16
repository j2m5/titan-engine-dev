import type { Buffer } from 'node:buffer'

/**
 * Чистые правила батч-оркестратора `scripts/batch-synth-heightmaps.ts`
 * (арка synth-heightmap, батч-перевод спутников), вынесенные в отдельный
 * тестируемый модуль — сам батч-скрипт top-level await'ит `run()` и не
 * поддаётся юнит-импорту без побочного запуска всего конвейера.
 */

/** band-low по умолчанию, км — переопределяется половиной окружности у малых тел (см. `bandLowKmFor`). */
export const BAND_LOW_KM_DEFAULT = 1500

/** Потолок разрешения по радиусу тела — Global Constraints плана арки; выход = min(источник, потолок). */
export function resolutionCeiling(radiusMeters: number): number {
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
