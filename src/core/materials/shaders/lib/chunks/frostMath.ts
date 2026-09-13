import type { FrostParams } from '@/core/terrain/frostParams'

/** CPU-зеркало маски инея (PlanetShaderTemplate, USE_TERRAIN_FROST). Держать синхронно с GLSL. */
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Экспозиция к полюсу ∈ [−1, 1]: slopeE/slopeN — градиент вверх по склону (восток/север); на равнине 0. */
export function frostFacing(slopeE: number, slopeN: number, sinLat: number): number {
  const slopeTan = Math.hypot(slopeE, slopeN)
  if (slopeTan <= 1e-6) return 0
  const pole = sinLat >= 0 ? 1 : -1
  return ((-slopeN / slopeTan) * pole) * smoothstep(0, 0.1, slopeTan)
}

export function frostLine(p: FrostParams, sinLat: number, facing: number): number {
  return p.frostLineMeters - p.frostPolarDropMeters * Math.abs(sinLat) - p.frostAspectMeters * Math.max(facing, 0)
}

export function frostMask(p: FrostParams, heightMeters: number, sinLat: number, slopeE: number, slopeN: number): number {
  const slopeTan = Math.hypot(slopeE, slopeN)
  const line = frostLine(p, sinLat, frostFacing(slopeE, slopeN, sinLat))
  const half = 0.5 * p.frostLineWidthMeters
  return p.frostStrength * smoothstep(line - half, line + half, heightMeters) * (1 - smoothstep(0.7 * p.frostSlopeMax, p.frostSlopeMax, slopeTan))
}
