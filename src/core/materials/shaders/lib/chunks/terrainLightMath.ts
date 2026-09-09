/**
 * CPU-зеркало композиции света суши (PlanetShaderTemplate, ветка USE_TERRAIN_UV):
 *   ambient    = uTerrainAmbient · skyTerm · occlusion
 *   directGain = mix(1, occlusion, uTerrainOcclusionDirect) · cloudShadow
 *   lit        = mix(ambient, directGain, max(N·L, 0))
 *   dayColor   = albedo · mix(1, lit, uTerrainLambert)
 * Держать синхронно с GLSL.
 */
export type Vec3 = [number, number, number]

export interface TerrainLitInput {
  ndotl: number
  ambient: number
  skyTerm: Vec3
  occlusion: number
  kDirect: number
  cloudShadow: number
  lambert: number
}

// Ровно форма GLSL-mix (x·(1−a) + y·a), а не a + (b−a)·t: на концах (t = 0/1)
// даёт вход бит-в-бит, иначе зеркало расходится с шейдером в последнем разряде
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t

export function terrainLit(i: TerrainLitInput): Vec3 {
  const l = Math.max(i.ndotl, 0)
  const directGain = mix(1, i.occlusion, i.kDirect) * i.cloudShadow
  const lit = i.skyTerm.map((s: number): number => mix(i.ambient * s * i.occlusion, directGain, l)) as Vec3
  return lit.map((v: number): number => mix(1, v, i.lambert)) as Vec3
}
