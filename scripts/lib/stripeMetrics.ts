export interface StripeReport {
  maxSeam: number
  maxSeamLatDeg: number
  medianSeam: number
  atLat: Array<{ latDeg: number; seam: number }>
}

/**
 * Широта, севернее/южнее которой строки не участвуют: у полюсов оверсэмпл по
 * долготе и мало независимых отсчётов в строке — статистика шумная.
 */
export const STRIPE_MAX_LAT_DEG = 70

/**
 * Поле на эквиректангулярной сетке → профиль анизотропии и широтные швы.
 * A(y) = rmsNS(y) / rmsEW(y); EW-разность делится на cos φ (метрика), поэтому
 * для изотропного гладкого поля A ≈ const. Шов — скачок ln A между соседними
 * окнами по `window` строк; плавный тренд даёт малый шов, ступень — большой.
 */
export function stripeReport(
  field: Float64Array,
  width: number,
  height: number,
  checkLatDeg: number[],
  window = 6
): StripeReport {
  const rowLat = (y: number): number => 90 - ((y + 0.5) / height) * 180
  const aRow = new Float64Array(height).fill(NaN)

  for (let y = 0; y < height - 1; y++) {
    const cosLat = Math.cos((rowLat(y) * Math.PI) / 180)
    if (Math.abs(rowLat(y)) > STRIPE_MAX_LAT_DEG || Math.abs(rowLat(y + 1)) > STRIPE_MAX_LAT_DEG) continue

    let ew = 0
    let ns = 0
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const dx = field[y * width + ((x + 1) % width)] - field[i]
      const dy = field[i + width] - field[i]
      ew += dx * dx
      ns += dy * dy
    }

    const rmsEw = Math.sqrt(ew / width) / cosLat
    const rmsNs = Math.sqrt(ns / width)
    aRow[y] = (rmsNs + 1e-12) / (rmsEw + 1e-12)
  }

  const meanA = (from: number, to: number): number => {
    let sum = 0
    for (let y = from; y < to; y++) sum += aRow[y]

    return sum / (to - from)
  }

  const seams = new Float64Array(height).fill(NaN)
  const valid: number[] = []

  for (let y = window; y + window <= height - 1; y++) {
    const s = Math.abs(Math.log(meanA(y - window, y)) - Math.log(meanA(y, y + window)))
    if (!Number.isFinite(s)) continue
    seams[y] = s
    valid.push(y)
  }

  if (valid.length === 0) return { maxSeam: NaN, maxSeamLatDeg: NaN, medianSeam: NaN, atLat: [] }

  // Шов у верхней кромки строки y — граница между окнами.
  const edgeLat = (y: number): number => 90 - (y / height) * 180
  let best = valid[0]
  for (const y of valid) if (seams[y] > seams[best]) best = y

  const sorted = valid.map((y) => seams[y]).sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  const atLat = checkLatDeg.map((latDeg) => {
    let nearest = valid[0]
    for (const y of valid) if (Math.abs(edgeLat(y) - latDeg) < Math.abs(edgeLat(nearest) - latDeg)) nearest = y

    return { latDeg: edgeLat(nearest), seam: seams[nearest] }
  })

  return { maxSeam: seams[best], maxSeamLatDeg: edgeLat(best), medianSeam: median, atLat }
}
