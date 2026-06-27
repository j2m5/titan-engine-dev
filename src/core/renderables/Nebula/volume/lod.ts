import { NebulaLOD } from '@/core/renderables/Nebula/NebulaParams'

// Screen-radius thresholds (px) for the raymarch <-> impostor transition.
const IMPOSTOR_BELOW = 150 // fully impostor at/below this projected radius
const RAYMARCH_ABOVE = 450 // fully raymarch at/above this projected radius

/**
 * Fraction of the bake frame the nebula sphere fills. Shared by ImpostorBaker (to
 * place the bake camera) and the container (to size the billboard) so the baked
 * image maps 1:1 onto the quad and the crossfade stays aligned.
 */
export const IMPOSTOR_FRAME_FILL = 0.8

export interface LODResult {
  mode: 'raymarch' | 'impostor'
  /** 1 = full raymarch, 0 = full impostor; fractional in the transition band. */
  blend: number
}

/**
 * Pick the LOD from the nebula's projected screen radius. Pure (no Three deps) so
 * it is unit-testable; the GPU baker/billboard are verified visually.
 */
export function selectLOD(screenRadiusPx: number, forced: NebulaLOD): LODResult {
  if (forced === 'raymarch') return { mode: 'raymarch', blend: 1 }
  if (forced === 'impostor') return { mode: 'impostor', blend: 0 }
  if (screenRadiusPx >= RAYMARCH_ABOVE) return { mode: 'raymarch', blend: 1 }
  if (screenRadiusPx <= IMPOSTOR_BELOW) return { mode: 'impostor', blend: 0 }
  const blend = (screenRadiusPx - IMPOSTOR_BELOW) / (RAYMARCH_ABOVE - IMPOSTOR_BELOW)
  return { mode: blend > 0.5 ? 'raymarch' : 'impostor', blend }
}
