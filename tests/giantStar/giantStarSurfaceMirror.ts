/**
 * CPU-зеркало композиционной части чанка giantStarSurface (gsEnergy, цвет,
 * gsCompose). Шумовое поле gsCellT не зеркалится: GLSL-шум из vitest не
 * исполнить, его структура закреплена строковыми пинами.
 */
import { planckLimb, type Vec3 } from '../helpers/planckLimbMirror'

export const GS_HDR_CEILING: number = 64.0

function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t
}

/** Зеркало gsEnergy */
export function gsEnergy(t: number, energy: Vec3): number {
  return t < 0.5 ? mix(energy[0], energy[1], t * 2.0) : mix(energy[1], energy[2], t * 2.0 - 1.0)
}

/** Зеркало starGranuleColor из чанка starSurface */
export function granuleColor(t: number, cool: Vec3, base: Vec3, hot: Vec3): Vec3 {
  return [0, 1, 2].map((i: number) =>
    t < 0.5 ? mix(cool[i], base[i], t * 2.0) : mix(base[i], hot[i], t * 2.0 - 1.0)
  ) as Vec3
}

/** Зеркало gsCompose */
export function gsCompose(
  t: number,
  mu: number,
  cool: Vec3,
  base: Vec3,
  hot: Vec3,
  cellEnergy: Vec3,
  planckX: Vec3,
  intensity: number,
  exposure: number
): Vec3 {
  const color: Vec3 = granuleColor(t, cool, base, hot)
  const energy: number = gsEnergy(t, cellEnergy) * intensity
  const limb: Vec3 = planckLimb(mu, planckX)

  return color.map((c: number, i: number) => Math.min(c * energy * limb[i], GS_HDR_CEILING) * exposure) as Vec3
}
