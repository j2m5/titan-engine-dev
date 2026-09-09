import sharp from 'sharp'

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/**
 * Среднее с учётом клампа шейдера: TerrainDetail клампит diff·norm и ao·norm
 * в [0, 2], поэтому нормировка обычным средним оставляла среднее слоя < 1
 * (яркий хвост срезан). Ищется m, при котором mean(min(2·m, v)) = m —
 * итерация монотонна и сходится за десятки шагов; у текстур без хвоста
 * выше 2·mean совпадает с обычным средним.
 */
export function clampedMean(values: ArrayLike<number>, clamp: number = 2): number {
  let m = 0
  for (let i = 0; i < values.length; i++) m += values[i]
  m /= values.length
  for (let iter = 0; iter < 50; iter++) {
    let s = 0
    for (let i = 0; i < values.length; i++) s += Math.min(clamp * m, values[i])
    const next = s / values.length
    if (Math.abs(next - m) < 1e-7) return next
    m = next
  }
  return m
}

/** Люма Rec.709 в линейном свете (diff, sRGB-файл) и R-канал ARM (линейный), ресайз 512². */
export async function measureDetailStats(filePath: string): Promise<{ meanLum: number; meanAo: number }> {
  const { data, info } = await sharp(filePath).resize(512, 512).raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  const lum = new Float64Array(n)
  const ao = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * info.channels
    lum[i] =
      0.2126 * toLinear(data[p] / 255) + 0.7152 * toLinear(data[p + 1] / 255) + 0.0722 * toLinear(data[p + 2] / 255)
    ao[i] = data[p] / 255
  }
  return { meanLum: clampedMean(lum), meanAo: clampedMean(ao) }
}
