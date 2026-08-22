/**
 * CPU-зеркало средней полосы детали рельефа (TerrainMacroDetail.ts).
 * Единицы: радиус в км, результат macroFadeMetersFor — метры, остальное
 * безразмерно. Держать синхронно с GLSL.
 */

/**
 * Дистанция (в текселях диффуза), на которой тексель ≈ 1 экранному пикселю
 * при 1080p и fov ~50°: H / fov_rad ≈ 1237, с запасом ×1.2.
 */
export const MACRO_FADE_TEXEL_FACTOR = 1500

/** Начало fade относительно конца — общее для всех шкал детали (TerrainDetail, полоса). */
export const DETAIL_FADE_START_RATIO = 0.4

/** Конец fade полосы по умолчанию: полоса включается там, где диффуз перестаёт нести информацию. */
export function macroFadeMetersFor(radiusKm: number, diffuseWidth: number): number {
  if (radiusKm <= 0 || diffuseWidth <= 0) return 0

  const texelMeters = (2 * Math.PI * radiusKm * 1000) / diffuseWidth

  return texelMeters * MACRO_FADE_TEXEL_FACTOR
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))

  return t * t * (3 - 2 * t)
}

/** Вес октавы: 1 пока период ≥ 2 px, плавно к 0 при footprint·f → 1. */
export function octaveWeight(footprint: number, frequency: number): number {
  return 1 - smoothstep(0.5, 1, footprint * frequency)
}

/** 1 до 0.4·fadeEnd, 0 за fadeEnd — как у шкал TerrainDetail. */
export function distFade(viewDistance: number, fadeEnd: number): number {
  return 1 - smoothstep(DETAIL_FADE_START_RATIO * fadeEnd, fadeEnd, viewDistance)
}

/** Амплитуда по крутизне: равнина тише на influence, крутой склон (|slope|/SLOPE_RANGE ≥ 1) — полная. */
export function slopeGain(slopeLength: number, slopeInfluence: number): number {
  const s = Math.max(0, Math.min(1, slopeLength))

  return 1 - slopeInfluence + slopeInfluence * s
}

/** Амплитуда по cavity ∈ [−1, 1]: ямы тише, гребни громче; пол 0. */
export function cavityGain(cavity: number, cavityInfluence: number): number {
  return Math.max(0, 1 + cavityInfluence * cavity)
}
