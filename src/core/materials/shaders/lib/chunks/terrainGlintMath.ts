/** CPU-зеркало блика льда (PlanetShaderTemplate, USE_TERRAIN_GLINT). Держать синхронно с GLSL. */
export const ICE_GLINT_F0 = 0.018

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** Степень Блинна–Фонга по шероховатости: 8 (шероховатый) … 512 (гладкий лёд), по квадрату глянца. */
export function iceGlintPower(roughness: number): number {
  const gloss = 1 - clamp01(roughness)
  return 8 + (512 - 8) * gloss * gloss
}

/** Нормированный Блинн–Фонг × Френель Шлика (F0 льда) × глянец²; nDotH, vDotH — косинусы. */
export function iceGlint(nDotH: number, vDotH: number, roughness: number): number {
  const gloss = 1 - clamp01(roughness)
  const power = iceGlintPower(roughness)
  const fresnel = ICE_GLINT_F0 + (1 - ICE_GLINT_F0) * (1 - clamp01(vDotH)) ** 5
  return ((power + 8) / (8 * Math.PI)) * Math.max(nDotH, 0) ** power * fresnel * gloss * gloss
}
