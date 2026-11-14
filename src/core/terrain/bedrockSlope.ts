import { bilinearRange, BilinearRowRanges, type UvBounds, type ValueRange } from './terrainRange'

const absMin = (a: ValueRange): number => (a.min > 0 ? a.min : a.max < 0 ? -a.max : 0)
const absMax = (a: ValueRange): number => Math.max(Math.abs(a.min), Math.abs(a.max))

/** Continuous, metric DEM slope. Unlike the noise envelope grid, it retains narrow cliffs. */
export class BedrockSlope {
  private readonly rows: BilinearRowRanges

  public constructor(
    private readonly sampleMap: (u: number, v: number) => number,
    private readonly width: number,
    private readonly height: number,
    private readonly radiusMeters: number,
    private readonly mapRange: ValueRange
  ) {
    this.rows = new BilinearRowRanges(sampleMap, width, height)
  }

  private span(cosLat: number): number {
    return Math.min(0.25, 1 / (this.width * cosLat))
  }

  public sample(u: number, v: number, cosLat: number): number {
    if (cosLat <= 1e-12) return 0
    const du = this.span(cosLat),
      dv = 1 / this.height
    const east =
      (this.sampleMap(u + du, v) - this.sampleMap(u - du, v)) / (4 * Math.PI * this.radiusMeters * cosLat * du)
    const north = (this.sampleMap(u, v - dv) - this.sampleMap(u, v + dv)) / (2 * Math.PI * this.radiusMeters * dv)
    return Math.hypot(east, north)
  }

  /** Bound the same four samples and latitude-dependent metric; converges at a point. */
  public range(uv: UvBounds, minCos: number, maxCos: number): ValueRange {
    if (minCos <= 1e-12) return { min: 0, max: Infinity }
    const duMin = this.span(maxCos),
      duMax = this.span(minCos),
      dv = 1 / this.height
    const at = (u0: number, u1: number, v0: number, v1: number): ValueRange =>
      bilinearRange(
        this.sampleMap,
        this.width,
        this.height,
        { u0, u1, v0, v1 },
        this.mapRange,
        { min: 0, max: 0 },
        this.rows
      )
    const e = at(uv.u0 + duMin, uv.u1 + duMax, uv.v0, uv.v1)
    const w = at(uv.u0 - duMax, uv.u1 - duMin, uv.v0, uv.v1)
    const n = at(uv.u0, uv.u1, uv.v0 - dv, uv.v1 - dv)
    const s = at(uv.u0, uv.u1, uv.v0 + dv, uv.v1 + dv)
    const metricMin = 4 * Math.PI * this.radiusMeters * minCos * duMax
    const metricMax = 4 * Math.PI * this.radiusMeters * maxCos * duMin
    const east = {
      min: Math.min((e.min - w.max) / metricMin, (e.min - w.max) / metricMax),
      max: Math.max((e.max - w.min) / metricMin, (e.max - w.min) / metricMax)
    }
    const metricN = 2 * Math.PI * this.radiusMeters * dv
    const north = { min: (n.min - s.max) / metricN, max: (n.max - s.min) / metricN }
    return {
      min: Math.max(0, Math.hypot(absMin(east), absMin(north)) - 1e-12),
      max: Math.hypot(absMax(east), absMax(north)) + 1e-12
    }
  }
}
