/**
 * CPU-зеркало GLSL-чанка planckLimb. Повторяет `exp(x) - 1.0`, а не Math.expm1:
 * зеркало воспроизводит то, что считает шейдер, включая точность.
 */

export type Vec3 = [number, number, number]

export const PLANCK_LIMB_EDDINGTON_TAU: number = 0.66666667

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function planckLimb(mu: number, planckX: Vec3): Vec3 {
  const m: number = clamp(mu, 0.0, 1.0)
  const sMu: number = Math.pow(0.75 * (m + PLANCK_LIMB_EDDINGTON_TAU), 0.25)
  const sOne: number = Math.pow(0.75 * (1.0 + PLANCK_LIMB_EDDINGTON_TAU), 0.25)

  return planckX.map((x: number) => (Math.exp(x / sOne) - 1.0) / (Math.exp(x / sMu) - 1.0)) as Vec3
}
