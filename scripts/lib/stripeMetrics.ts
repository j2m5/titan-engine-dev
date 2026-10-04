export interface StripeCheck {
  /** Запрошенная широта. */
  latDeg: number
  /** Максимум шва в строках |y − y0| ≤ window; NaN — широта вне полосы. */
  seam: number
  /** Широта, где достигнут максимум; NaN — вне полосы. */
  peakLatDeg: number
}

export interface StripeReport {
  maxSeam: number
  maxSeamLatDeg: number
  medianSeam: number
  maxLatDeg: number
  atLat: StripeCheck[]
}

/** Число текселей строки, ниже которого статистика строки шумная. */
export const STRIPE_MIN_ROW_TEXELS = 800

/** Наибольшая |широта|, где в строке ≥ STRIPE_MIN_ROW_TEXELS текселей по долготе. */
export function defaultMaxLatDeg(width: number): number {
  if (width <= STRIPE_MIN_ROW_TEXELS) return 0

  return (Math.acos(STRIPE_MIN_ROW_TEXELS / width) * 180) / Math.PI
}

/**
 * Поле на эквиректангулярной сетке → профиль анизотропии и широтные швы.
 * A(y) = rmsNS(y) / rmsEW(y); EW-разность делится на cos φ (метрика), поэтому
 * для изотропного гладкого поля A ≈ const. Шов — скачок ln A между соседними
 * окнами по `window` строк (у ступени он треугольник шириной 2·window, поэтому
 * для проверяемой широты берётся пик в ±window строк). Строки севернее
 * `maxLatDeg` и строки с нулевой EW-разностью не участвуют.
 */
export function stripeReport(
  field: Float64Array,
  width: number,
  height: number,
  checkLatDeg: number[],
  window = 6,
  maxLatDeg = defaultMaxLatDeg(width)
): StripeReport {
  const rowLat = (y: number): number => 90 - ((y + 0.5) / height) * 180
  const edgeLat = (y: number): number => 90 - (y / height) * 180
  const aRow = new Float64Array(height).fill(NaN)

  for (let y = 0; y < height - 1; y++) {
    if (Math.abs(rowLat(y)) > maxLatDeg || Math.abs(rowLat(y + 1)) > maxLatDeg) continue

    let ew = 0
    let ns = 0
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const dx = field[y * width + ((x + 1) % width)] - field[i]
      const dy = field[i + width] - field[i]
      ew += dx * dx
      ns += dy * dy
    }

    const rmsEw = Math.sqrt(ew / width) / Math.cos((rowLat(y) * Math.PI) / 180)
    if (!(rmsEw > 1e-12)) continue
    aRow[y] = Math.sqrt(ns / width) / rmsEw
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

  if (valid.length === 0) {
    return {
      maxSeam: NaN,
      maxSeamLatDeg: NaN,
      medianSeam: NaN,
      maxLatDeg,
      atLat: checkLatDeg.map((latDeg) => ({ latDeg, seam: NaN, peakLatDeg: NaN })),
    }
  }

  let best = valid[0]
  for (const y of valid) if (seams[y] > seams[best]) best = y

  const sorted = valid.map((y) => seams[y]).sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  const atLat = checkLatDeg.map((latDeg): StripeCheck => {
    const y0 = Math.round(((90 - latDeg) / 180) * height)
    let peak = -1
    for (let y = y0 - window; y <= y0 + window; y++) {
      if (y >= 0 && y < height && Number.isFinite(seams[y]) && (peak < 0 || seams[y] > seams[peak])) peak = y
    }

    // Вне полосы окна с валидными швами нет — не подменяем ближайшей строкой.
    if (Math.abs(latDeg) > maxLatDeg || peak < 0) return { latDeg, seam: NaN, peakLatDeg: NaN }

    return { latDeg, seam: seams[peak], peakLatDeg: edgeLat(peak) }
  })

  return { maxSeam: seams[best], maxSeamLatDeg: edgeLat(best), medianSeam: median, maxLatDeg, atLat }
}
