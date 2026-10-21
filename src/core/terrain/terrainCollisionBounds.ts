import { Vector3 } from 'three'
import type { HeightMapData } from './heightMapFormat'
import type { MidbandParams } from './midbandParams'
import { ENVELOPE_GRID_HEIGHT, ENVELOPE_GRID_WIDTH, type MidbandEnvelopeGrid } from './midbandEnvelopeGrid'
import {
  MIDBAND_ENVELOPE_MAX,
  MIDBAND_POLAR_COS,
  MIDBAND_RIDGE_MEAN,
  midbandPolarWeight,
  WARP_FREQUENCY,
  WARP_OFFSET,
  type MidbandEnvelope,
  type MidbandField
} from './midbandField'
import {
  bilinearRange,
  BilinearRowRanges,
  roundedFloat32UpperBound,
  type UvBounds,
  type ValueRange
} from './terrainRange'
import { simplexNoise3Bounds } from './simplexNoise3Bounds'

interface CollisionBoundsSource {
  map: HeightMapData
  radiusMeters: number
  maxSagMeters: number
  marginMeters: number
  sampleMap: (u: number, v: number) => number
  sampleSag: (u: number, v: number) => number
  midband: MidbandField | null
  envelope: MidbandEnvelopeGrid | null
  params: MidbandParams
}

const range = (min: number, max: number): ValueRange => ({ min, max })
const product = (a: ValueRange, b: ValueRange): ValueRange => {
  const values = [a.min * b.min, a.min * b.max, a.max * b.min, a.max * b.max]
  const lo = Math.min(...values),
    hi = Math.max(...values)
  const pad = 16 * Number.EPSILON * (1 + Math.max(Math.abs(lo), Math.abs(hi)))
  return range(lo - pad, hi + pad)
}
const add = (a: ValueRange, b: ValueRange): ValueRange => range(a.min + b.min, a.max + b.max)
const negative = (a: ValueRange): ValueRange => range(-a.max, -a.min)
const scale = (a: ValueRange, b: number): ValueRange => product(a, range(b, b))
const absMin = (a: ValueRange): number => (a.min > 0 ? a.min : a.max < 0 ? -a.max : 0)
const smooth = (value: number, width: number): number => {
  const t = Math.max(0, Math.min(1, value / width))
  return t * t * (3 - 2 * t)
}

/** Верхняя граница существующего пола, без предположения о непрерывности шума или sag. */
export class TerrainCollisionBounds {
  private readonly center = new Vector3()
  private readonly uv: UvBounds = { u0: 0, u1: 1, v0: 0, v1: 1 }
  private readonly envScratch: MidbandEnvelope = { slopeTan: 0, curvature: 0, downE: 0, downN: 0 }
  private readonly mapRows: BilinearRowRanges
  private readonly sagRows: BilinearRowRanges
  private readonly envelopeRows = new Map<keyof MidbandEnvelope, BilinearRowRanges>()

  public constructor(private readonly source: CollisionBoundsSource) {
    this.mapRows = new BilinearRowRanges(source.sampleMap, source.map.width, source.map.height)
    this.sagRows = new BilinearRowRanges(source.sampleSag, source.map.width, source.map.height)
  }

  public heightUpperMeters(a: Vector3, b: Vector3): number {
    const { source, uv } = this
    const { map, midband, params } = source
    const center = this.center.copy(a).add(b)
    const positiveBand =
      midband === null
        ? 0
        : params.midbandStrength *
          MIDBAND_ENVELOPE_MAX *
          (1 - MIDBAND_RIDGE_MEAN) *
          midband.amplitudesMeters.reduce((sum, value) => sum + value, 0)
    // Aux records the maximum after Float32 pointSag aggregation, which may round down.
    const maxSag = roundedFloat32UpperBound(source.maxSagMeters)
    const globalUpper = map.maxMeters + positiveBand + maxSag + source.marginMeters
    if (center.lengthSq() < 1e-20) return globalUpper
    center.normalize()
    const chord = Math.max(center.distanceTo(a), center.distanceTo(b)) + 1e-12
    const angle = 2 * Math.asin(Math.min(1, chord / 2))
    const colat = Math.atan2(Math.hypot(center.x, center.z), center.y)
    const lo = Math.max(0, colat - angle),
      hi = Math.min(Math.PI, colat + angle)
    // Сам runtime берёт acos(dir.y). Его потерю точности около полюса
    // включаем в UV-область через расширение y, а не малый фиксированный dv.
    uv.v0 = Math.acos(Math.min(1, Math.cos(lo) + 4 * Number.EPSILON)) / Math.PI
    uv.v1 = Math.acos(Math.max(-1, Math.cos(hi) - 4 * Number.EPSILON)) / Math.PI
    const minCos = Math.max(0, Math.min(Math.sin(lo), Math.sin(hi)))
    const maxCos = lo <= Math.PI / 2 && hi >= Math.PI / 2 ? 1 : Math.max(Math.sin(lo), Math.sin(hi))
    const longitude = Math.atan2(center.z, -center.x) / (2 * Math.PI)
    const du = minCos <= 1e-12 ? 0.5 : Math.min(0.5, angle / (2 * Math.PI * minCos) + 1e-12)
    uv.u0 = longitude - du
    uv.u1 = longitude + du
    const mapRange = bilinearRange(
      source.sampleMap,
      map.width,
      map.height,
      uv,
      range(map.minMeters, map.maxMeters),
      range(0, 0),
      this.mapRows
    )
    const sagRange = bilinearRange(
      source.sampleSag,
      map.width,
      map.height,
      uv,
      range(0, maxSag),
      range(0, 0),
      this.sagRows
    )
    let band = 0
    if (midband !== null && midband.octaveCount > 0 && source.envelope !== null) {
      band = this.midbandUpper(mapRange, center, chord, minCos, maxCos)
    }
    const upper = mapRange.max + band + sagRange.max + source.marginMeters
    return upper + 1e-8 + 1e-10 * (Math.abs(mapRange.max) + Math.abs(band) + sagRange.max)
  }

  private channel(key: keyof MidbandEnvelope, fallback: ValueRange): ValueRange {
    let rows = this.envelopeRows.get(key)
    if (rows === undefined) {
      rows = new BilinearRowRanges(
        (u, v) => this.source.envelope!.sample(u, v, this.envScratch)[key],
        ENVELOPE_GRID_WIDTH,
        ENVELOPE_GRID_HEIGHT
      )
      this.envelopeRows.set(key, rows)
    }
    return bilinearRange(
      (u, v) => this.source.envelope!.sample(u, v, this.envScratch)[key],
      ENVELOPE_GRID_WIDTH,
      ENVELOPE_GRID_HEIGHT,
      this.uv,
      fallback,
      range(0, 0),
      rows
    )
  }

  private midbandUpper(map: ValueRange, center: Vector3, chord: number, minCos: number, maxCos: number): number {
    const { params, midband, radiusMeters } = this.source
    const field = midband!
    const slope = this.channel('slopeTan', range(0, Infinity))
    const curvature = this.channel('curvature', range(-1, 1))
    const envelopeAt = (s: number, c: number): number =>
      Math.min(
        MIDBAND_ENVELOPE_MAX,
        Math.max(
          0,
          params.midbandFlat +
            Math.min(1, Math.max(0, s / params.midbandSlopeRef)) +
            params.midbandRidge * Math.max(0, c)
        )
      )
    let envelope = range(envelopeAt(slope.min, curvature.min), envelopeAt(slope.max, curvature.max))
    if (params.waterLevelMeters !== null) {
      const depth = range(map.min - params.waterLevelMeters, map.max - params.waterLevelMeters)
      envelope = product(
        envelope,
        range(
          smooth(absMin(depth), field.waterFadeMeters),
          smooth(Math.max(Math.abs(depth.min), Math.abs(depth.max)), field.waterFadeMeters)
        )
      )
    }
    envelope = product(envelope, range(midbandPolarWeight(minCos), midbandPolarWeight(maxCos)))
    // Пад product может дать -epsilon у нулевой огибающей; физический интервал неотрицателен.
    envelope.min = Math.max(0, envelope.min)
    envelope.max = Math.max(0, envelope.max)
    if (envelope.max === 0) return 0
    const k = radiusMeters / field.wavelengthsMeters[0]
    const dx = range(center.x - chord, center.x + chord)
    const dy = range(center.y - chord, center.y + chord)
    const dz = range(center.z - chord, center.z + chord)
    const downE = this.channel('downE', range(-1, 1)),
      downN = this.channel('downN', range(-1, 1))
    // weight/cosLat без сингулярного деления: внутри cap это парабола,
    // с максимумом при cosLat=.75c, снаружи — 1/cosLat.
    const ratioAt = (r: number): number =>
      r >= MIDBAND_POLAR_COS
        ? 1 / r
        : ((3 * r) / MIDBAND_POLAR_COS - 2 * (r / MIDBAND_POLAR_COS) ** 2) / MIDBAND_POLAR_COS
    const ratioLo = ratioAt(minCos),
      ratioHi = ratioAt(maxCos)
    const ratio = range(
      Math.min(ratioLo, ratioHi),
      minCos <= 0.75 * MIDBAND_POLAR_COS && maxCos >= 0.75 * MIDBAND_POLAR_COS
        ? 1.125 / MIDBAND_POLAR_COS
        : Math.max(ratioLo, ratioHi)
    )
    const wx = product(ratio, add(product(downE, dz), negative(product(downN, product(dy, dx)))))
    const wy = product(downN, range(midbandPolarWeight(minCos) * minCos, midbandPolarWeight(maxCos) * maxCos))
    const wz = product(ratio, negative(add(product(downE, dx), product(downN, product(dy, dz)))))
    const warpNoise = simplexNoise3Bounds(
      center.x * k * WARP_FREQUENCY + WARP_OFFSET,
      center.y * k * WARP_FREQUENCY,
      center.z * k * WARP_FREQUENCY,
      chord * k * WARP_FREQUENCY,
      range(0, 0)
    )
    const warp = scale(warpNoise, params.midbandWarp)
    const domain = [
      add(scale(dx, k), product(wx, warp)),
      add(scale(dy, k), product(wy, warp)),
      add(scale(dz, k), product(wz, warp))
    ]
    const cx = (domain[0].min + domain[0].max) / 2
    const cy = (domain[1].min + domain[1].max) / 2
    const cz = (domain[2].min + domain[2].max) / 2
    const radius =
      Math.hypot(domain[0].max - domain[0].min, domain[1].max - domain[1].min, domain[2].max - domain[2].min) / 2
    let upper = 0
    for (let i = 0; i < field.octaveCount; i++) {
      const frequency = 2 ** i
      const noise = simplexNoise3Bounds(cx * frequency, cy * frequency, cz * frequency, radius * frequency, range(0, 0))
      upper += field.amplitudesMeters[i] * (1 - MIDBAND_RIDGE_MEAN - absMin(noise))
    }
    return params.midbandStrength * upper * (upper >= 0 ? envelope.max : envelope.min)
  }
}
