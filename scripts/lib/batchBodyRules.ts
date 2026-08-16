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

/**
 * Area-average (box) даунсемпл яркости [0..1] до кратного целого коэффициента
 * уменьшения. НЕ через sharp `.resize` — установленная версия sharp не
 * экспонирует box-кернел (`sharp.kernel` даёт только nearest/linear/cubic/
 * mitchell/lanczos2/lanczos3/mks2013/mks2021, без box); `resampleDem.ts`
 * заточен под float DEM другого конвейера (lanczos3, `.raw({depth:'float'})`)
 * — копировать нечего, кернел там для другой задачи. Коэффициент должен
 * делить оба измерения нацело — потолки разрешения батча (`resolutionCeiling`)
 * и реальные размеры входов это гарантируют для всех 18 генераций.
 */
export function boxDownsampleGreyscale(
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Float64Array {
  if (sourceWidth % targetWidth !== 0 || sourceHeight % targetHeight !== 0) {
    throw new Error(
      `Даунсемпл: источник ${sourceWidth}×${sourceHeight} не делится нацело на выход ${targetWidth}×${targetHeight}`
    )
  }

  const blockW = sourceWidth / targetWidth
  const blockH = sourceHeight / targetHeight
  const out = new Float64Array(targetWidth * targetHeight)

  for (let ty = 0; ty < targetHeight; ty++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      let sum = 0
      for (let by = 0; by < blockH; by++) {
        const rowOffset = (ty * blockH + by) * sourceWidth
        for (let bx = 0; bx < blockW; bx++) sum += source[rowOffset + tx * blockW + bx]
      }
      out[ty * targetWidth + tx] = sum / (blockW * blockH * 255)
    }
  }

  return out
}
