export interface ValueRange {
  min: number
  max: number
}
export interface UvBounds {
  u0: number
  u1: number
  v0: number
  v1: number
}

/** Upper enclosure after one or more round-to-nearest Float32 storage steps. */
export function roundedFloat32UpperBound(value: number, roundings: number = 1): number {
  return value + roundings * (Math.abs(value) * 2 ** -23 + 2 ** -149)
}

/** Lazy longitude extrema for thin, wide polar rectangles. Memory is bounded to 16 rows. */
export class BilinearRowRanges {
  private readonly rows = new Map<number, { min: Float64Array; max: Float64Array }>()
  private readonly size: number

  public constructor(
    private readonly sample: (u: number, v: number) => number,
    private readonly width: number,
    private readonly height: number
  ) {
    this.size = 2 ** Math.ceil(Math.log2(width))
  }

  public range(uv: UvBounds, fallback: ValueRange): ValueRange {
    if (Math.ceil((uv.v1 - uv.v0) * this.height) + 2 > 8) return fallback
    let min = Infinity,
      max = -Infinity
    for (const v of knots(uv.v0, uv.v1, this.height)) {
      const y = v * this.height - 0.5
      let row: number, t: number
      if (y < 0) {
        row = -1
        t = 2 * v * this.height
      } else if (y >= this.height - 1) {
        row = this.height - 1
        t = 2 * (y - row)
      } else {
        row = Math.floor(y)
        t = y - row
      }
      t = Math.max(0, Math.min(1, t))
      const a = this.rowRange(row, uv.u0, uv.u1),
        b = this.rowRange(row + 1, uv.u0, uv.u1)
      min = Math.min(min, a.min * (1 - t) + b.min * t)
      max = Math.max(max, a.max * (1 - t) + b.max * t)
    }
    const error = 1e-12 * (1 + Math.max(Math.abs(min), Math.abs(max)))
    return { min: min - error, max: max + error }
  }

  private rowRange(row: number, u0: number, u1: number): ValueRange {
    let tree = this.rows.get(row)
    if (tree === undefined) {
      tree = {
        min: new Float64Array(2 * this.size).fill(Infinity),
        max: new Float64Array(2 * this.size).fill(-Infinity)
      }
      const v = row < 0 ? 0 : row >= this.height ? 1 : (row + 0.5) / this.height
      for (let x = 0; x < this.width; x++) {
        tree.min[this.size + x] = tree.max[this.size + x] = this.sample((x + 0.5) / this.width, v)
      }
      for (let i = this.size - 1; i > 0; i--) {
        tree.min[i] = Math.min(tree.min[2 * i], tree.min[2 * i + 1])
        tree.max[i] = Math.max(tree.max[2 * i], tree.max[2 * i + 1])
      }
      if (this.rows.size >= 16) this.rows.delete(this.rows.keys().next().value!)
    } else this.rows.delete(row)
    this.rows.set(row, tree)
    // Whole touched cells are allowed only on this coarse path. The small-query
    // path in bilinearRange keeps clipped extrema and therefore converges.
    const first = Math.floor(u0 * this.width - 0.5),
      last = Math.ceil(u1 * this.width - 0.5)
    if (last - first + 1 >= this.width) return { min: tree.min[1], max: tree.max[1] }
    const start = ((first % this.width) + this.width) % this.width
    const end = start + last - first + 1
    let min = Infinity,
      max = -Infinity
    const query = (lo: number, hi: number): void => {
      for (let l = lo + this.size, r = hi + this.size; l < r; l = Math.floor(l / 2), r = Math.floor(r / 2)) {
        if (l % 2) {
          min = Math.min(min, tree.min[l])
          max = Math.max(max, tree.max[l++])
        }
        if (r % 2) {
          --r
          min = Math.min(min, tree.min[r])
          max = Math.max(max, tree.max[r])
        }
      }
    }
    query(start, Math.min(end, this.width))
    if (end > this.width) query(0, end - this.width)
    return { min, max }
  }
}

/** Все внутренние узлы плюс края прямоугольника; полутексельная конвенция с wrap u / clamp v. */
function knots(lo: number, hi: number, size: number): number[] {
  const result = [lo]
  for (let i = Math.floor(lo * size - 0.5) + 1; (i + 0.5) / size < hi; i++) result.push((i + 0.5) / size)
  if (hi > lo) result.push(hi)
  return result
}

/**
 * Билинейная функция достигает экстремума на углах ограниченной ячейки.
 * Берём именно пересечение ячейки с запросом: целые тексели не сходятся
 * к точке при subdivision. Большая область имеет фиксированную стоимость.
 */
export function bilinearRange(
  sample: (u: number, v: number) => number,
  width: number,
  height: number,
  uv: UvBounds,
  fallback: ValueRange,
  out: ValueRange,
  rows?: BilinearRowRanges
): ValueRange {
  const countU = Math.ceil((uv.u1 - uv.u0) * width) + 2
  const countV = Math.ceil((uv.v1 - uv.v0) * height) + 2
  if (countU * countV > 64) {
    const coarse = rows?.range(uv, fallback) ?? fallback
    out.min = coarse.min
    out.max = coarse.max
    return out
  }
  const us = knots(uv.u0, uv.u1, width),
    vs = knots(uv.v0, uv.v1, height)
  out.min = Infinity
  out.max = -Infinity
  for (const v of vs)
    for (const u of us) {
      const value = sample(u, v)
      out.min = Math.min(out.min, value)
      out.max = Math.max(out.max, value)
    }
  const error = 1e-12 * (1 + Math.max(Math.abs(out.min), Math.abs(out.max)))
  out.min -= error
  out.max += error
  return out
}
