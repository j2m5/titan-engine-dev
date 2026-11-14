import { Vector3 } from 'three'

/** Integer hash: stable across cache eviction, independent of traversal order. */
export function boulderRandom(seed: number): number {
  let h = seed >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const a = new Vector3(),
  b = new Vector3(),
  c = new Vector3()
const ab = new Vector3(),
  ac = new Vector3(),
  edge = new Vector3(),
  offset = new Vector3()

/** Coordinates are grid cells, positions are resident RTC vertices. Returns edge clearance in scene units. */
export function sampleBoulderTriangle(
  positions: ArrayLike<number>,
  segments: number,
  x: number,
  y: number,
  center: Vector3,
  point: Vector3,
  normal: Vector3
): number {
  const i = Math.min(segments - 1, Math.max(0, Math.floor(x)))
  const j = Math.min(segments - 1, Math.max(0, Math.floor(y)))
  const u = x - i,
    v = y - j,
    k = j * (segments + 1) + i
  a.fromArray(positions, 3 * k)
  if (u >= v) {
    b.fromArray(positions, 3 * (k + 1))
    c.fromArray(positions, 3 * (k + segments + 2))
    point
      .copy(a)
      .multiplyScalar(1 - u)
      .addScaledVector(b, u - v)
      .addScaledVector(c, v)
  } else {
    b.fromArray(positions, 3 * (k + segments + 2))
    c.fromArray(positions, 3 * (k + segments + 1))
    point
      .copy(a)
      .multiplyScalar(1 - v)
      .addScaledVector(b, u)
      .addScaledVector(c, v - u)
  }
  normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize()
  let margin = Infinity
  for (const [p, q] of [
    [a, b],
    [b, c],
    [c, a]
  ]) {
    edge.subVectors(q, p)
    offset.subVectors(point, p).cross(edge)
    margin = Math.min(margin, offset.length() / edge.length())
  }
  point.add(center)
  return margin
}

export function resolveBoulderDensity(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2)
    throw new Error('[TerrainBoulders] boulderDensity must be finite and between 0 and 2')
  return value
}
