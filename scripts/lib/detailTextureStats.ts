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

/**
 * То же уравнение неподвижной точки, что у `clampedMean`, но шейдер клампит
 * КАЖДЫЙ канал по отдельности (`clamp(diffuse·norm, 0, 2)`) и только потом
 * берёт люму — клампить уже готовую люму неточно. Ищется m, при котором
 * mean(0.2126·min(2m,r) + 0.7152·min(2m,g) + 0.0722·min(2m,b)) = m.
 */
export function clampedLumaMean(
  r: ArrayLike<number>,
  g: ArrayLike<number>,
  b: ArrayLike<number>,
  clamp: number = 2
): number {
  let m = 0
  for (let i = 0; i < r.length; i++) m += 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i]
  m /= r.length
  for (let iter = 0; iter < 50; iter++) {
    let s = 0
    for (let i = 0; i < r.length; i++) {
      s += 0.2126 * Math.min(clamp * m, r[i]) + 0.7152 * Math.min(clamp * m, g[i]) + 0.0722 * Math.min(clamp * m, b[i])
    }
    const next = s / r.length
    if (Math.abs(next - m) < 1e-7) return next
    m = next
  }
  return m
}

/**
 * Люма Rec.709 в линейном свете (diff, sRGB-файл) и R-канал ARM (линейный), ресайз 512².
 * Неподвижная точка мерится на ресайзе 512² — значит она ограничивает эффект
 * нативного разрешения снизу.
 */
export async function measureDetailStats(filePath: string): Promise<{ meanLum: number; meanAo: number }> {
  const { data, info } = await sharp(filePath).resize(512, 512).raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  const r = new Float64Array(n)
  const g = new Float64Array(n)
  const b = new Float64Array(n)
  const ao = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * info.channels
    r[i] = toLinear(data[p] / 255)
    g[i] = toLinear(data[p + 1] / 255)
    b[i] = toLinear(data[p + 2] / 255)
    ao[i] = data[p] / 255
  }
  return { meanLum: clampedLumaMean(r, g, b), meanAo: clampedMean(ao) }
}
