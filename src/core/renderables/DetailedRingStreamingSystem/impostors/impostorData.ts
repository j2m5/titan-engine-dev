import { Vector2, Vector3 } from 'three'
import type { ImpostorFrameBasis } from './impostorLayout'

export type ImpostorRgba = [number, number, number, number]

export interface ImpostorTexel {
  normal: Vector3
  depth01: number
  freshness: number
  cavity: number
  coverage: number
}

export interface PackedImpostorTexel {
  normalDepth: ImpostorRgba
  surfaceCoverage: ImpostorRgba
}

const saturate = (value: number): number => Math.min(1, Math.max(0, value))
const emptyTexel = (): PackedImpostorTexel => ({ normalDepth: [0, 0, 0, 0], surfaceCoverage: [0, 0, 0, 0] })

export function encodeImpostorTexel(texel: ImpostorTexel): PackedImpostorTexel {
  const values = [...texel.normal.toArray(), texel.depth01, texel.freshness, texel.cavity, texel.coverage]
  if (!values.every(Number.isFinite) || texel.normal.lengthSq() < 1e-12) return emptyTexel()
  const coverage = saturate(texel.coverage)
  const n = texel.normal.clone().normalize()
  return {
    normalDepth: [(n.x * 0.5 + 0.5) * coverage, (n.y * 0.5 + 0.5) * coverage, (n.z * 0.5 + 0.5) * coverage, saturate(texel.depth01) * coverage],
    surfaceCoverage: [saturate(texel.freshness) * coverage, saturate(texel.cavity) * coverage, 0, coverage]
  }
}

export function decodeImpostorTexel(texel: PackedImpostorTexel): ImpostorTexel | null {
  const coverage = texel.surfaceCoverage[3]
  if (![...texel.normalDepth, ...texel.surfaceCoverage].every(Number.isFinite) || coverage <= 1e-5 || coverage > 1.00001) return null
  const normal = new Vector3(texel.normalDepth[0], texel.normalDepth[1], texel.normalDepth[2]).multiplyScalar(2 / coverage).addScalar(-1)
  if (normal.lengthSq() < 1e-12) return null
  return {
    normal: normal.normalize(),
    depth01: saturate(texel.normalDepth[3] / coverage),
    freshness: saturate(texel.surfaceCoverage[0] / coverage),
    cavity: saturate(texel.surfaceCoverage[1] / coverage),
    coverage
  }
}

/** Эталон усреднения premultiplied-данных, без цветового преобразования. */
export function averageImpostorTexels(texels: readonly [PackedImpostorTexel, PackedImpostorTexel, PackedImpostorTexel, PackedImpostorTexel]): PackedImpostorTexel {
  const result = emptyTexel()
  for (const texel of texels) {
    for (let i = 0; i < 4; i++) {
      result.normalDepth[i] += texel.normalDepth[i] * 0.25
      result.surfaceCoverage[i] += texel.surfaceCoverage[i] * 0.25
    }
  }
  return result
}

export function captureProjection(origin: Vector3, ray: Vector3, basis: ImpostorFrameBasis, halfExtent: number, depth01: number): { uv: Vector2; t: number } | null {
  if (![...origin.toArray(), ...ray.toArray(), halfExtent, depth01].every(Number.isFinite) || halfExtent <= 0 || depth01 < 0 || depth01 > 1) return null
  const denominator = ray.dot(basis.direction)
  if (ray.lengthSq() === 0 || Math.abs(denominator) <= 1e-5 * ray.length()) return null
  const t = (halfExtent * (2 * depth01 - 1) - origin.dot(basis.direction)) / denominator
  if (!Number.isFinite(t) || t <= 0) return null
  const point = origin.clone().addScaledVector(ray, t)
  const uv = new Vector2(0.5 + point.dot(basis.right) / (2 * halfExtent), 0.5 + point.dot(basis.up) / (2 * halfExtent))
  return uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1 ? { uv, t } : null
}
