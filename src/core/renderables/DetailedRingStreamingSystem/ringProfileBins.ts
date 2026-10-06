import { applyRingGapsToBins, type RingGap } from './ringMoonlets'

/**
 * Постобработка радиальных бинов профиля кольца (чистые функции, без canvas):
 * порог, гауссово размытие и маска щелей лунок. Читает их RingAlphaReadback.
 */

/**
 * Порог, затем гауссово размытие (в этом порядке: хвост тянется от УЖЕ
 * отсечённой кромки, слабое гало ниже порога его не подпитывает).
 * За границами профиля пустота — масса у краёв кольца частично «выдувается»
 * наружу и теряется, как и у физической кромки.
 */
const thresholdAndBlur = (values: Float32Array, alphaTest: number, sigmaBins: number): Float32Array => {
  const thresholded = values.map((a) => (a > alphaTest ? a : 0))
  if (sigmaBins <= 0) return thresholded

  // Ядро гаусса, обрезанное на 3σ, нормированное на единицу
  const kernelRadius = Math.max(1, Math.ceil(sigmaBins * 3))
  const kernel = new Float64Array(kernelRadius + 1)
  let kernelSum = 0
  for (let d = 0; d <= kernelRadius; d++) {
    kernel[d] = Math.exp(-(d * d) / (2 * sigmaBins * sigmaBins))
    kernelSum += d === 0 ? kernel[d] : 2 * kernel[d]
  }

  const blurred = new Float32Array(thresholded.length)
  for (let i = 0; i < thresholded.length; i++) {
    let sum = thresholded[i] * kernel[0]
    for (let d = 1; d <= kernelRadius; d++) {
      const left = i - d
      const right = i + d
      if (left >= 0) sum += thresholded[left] * kernel[d]
      if (right < thresholded.length) sum += thresholded[right] * kernel[d]
    }
    blurred[i] = sum / kernelSum
  }

  return blurred
}

/**
 * Маска щелей → порог alphaTest → размытие σ (в бинах) → снова маска щелей.
 * Маска до размытия не даёт массе щели расползтись по соседям, маска после —
 * не даёт размытию залить щель обратно (σ камней/пыли сравнима с шириной
 * щели); у щели остаются мягкие «плечи» от размытой кромки. Вход не меняется.
 */
export function thresholdBlurAndMask(
  values: Float32Array,
  alphaTest: number,
  sigmaBins: number,
  inner: number,
  outer: number,
  gaps: readonly RingGap[]
): Float32Array {
  const masked = applyRingGapsToBins(values.slice(), inner, outer, gaps)
  return applyRingGapsToBins(thresholdAndBlur(masked, alphaTest, sigmaBins), inner, outer, gaps)
}

/**
 * Цвет и альфа полос из RGBA-пикселей колонок (по четыре байта на бин):
 * все каналы — порог 0 и размытие одной σ (кромки совпадают), щели гасят
 * ТОЛЬКО альфу. RGB не маскируется: нулевой цвет в щели утянул бы тинт полос
 * (ringBandTint) к нижней границе и погасил цвет листа для ring-shine.
 */
export function ringBandBinsFromPixels(
  pixels: Uint8ClampedArray,
  bins: number,
  sigmaBins: number,
  inner: number,
  outer: number,
  gaps: readonly RingGap[]
): { color: Float32Array; alpha: Float32Array } {
  const channel = (k: number): Float32Array => {
    const values = new Float32Array(bins)
    for (let i = 0; i < bins; i++) values[i] = pixels[i * 4 + k] / 255
    return thresholdBlurAndMask(values, 0, sigmaBins, inner, outer, k === 3 ? gaps : [])
  }

  const r = channel(0)
  const g = channel(1)
  const b = channel(2)
  const color = new Float32Array(bins * 3)
  for (let i = 0; i < bins; i++) {
    color[i * 3] = r[i]
    color[i * 3 + 1] = g[i]
    color[i * 3 + 2] = b[i]
  }

  return { color, alpha: channel(3) }
}
