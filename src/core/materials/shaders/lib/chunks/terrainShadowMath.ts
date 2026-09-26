/**
 * CPU-зеркало марша тени рельефа (чанк TerrainShadowMarch). Держать синхронно
 * с GLSL: чанк подставляет константы отсюда в свои #define.
 */
export const TERRAIN_SHADOW_STEPS = 20
/** bias = texel · это; высота, ниже которой склон на себя тени не кладёт (≈3°). */
export const TERRAIN_SHADOW_BIAS_SLOPE = 0.05
/** Пол полутени — антиалиасинг края: физическая полутень Солнца с орбиты субпиксельна. */
export const TERRAIN_SHADOW_PENUMBRA_FLOOR = 0.005
/** Угловой радиус Солнца с Земли — фолбэк без атмосферы и без звезды. */
export const DEFAULT_SUN_ANGULAR_RADIUS = 0.0093

export type Vec3 = [number, number, number]
export type HeightSampler = (uv: [number, number]) => number

export interface ShadowMarchParams {
  radius: number
  texelAngle: number
  maxDist: number
  penumbraTan: number
}

const TWO_PI = Math.PI * 2

/** u = atan2(z, −x)/2π ∈ [0,1), v = acos(y)/π (0 — север; строка 0 DataTexture). */
export function terrainShadowUv(dir: Vec3): [number, number] {
  let phi = Math.atan2(dir[2], -dir[0])
  if (phi < 0) phi += TWO_PI
  return [phi / TWO_PI, Math.acos(Math.max(-1, Math.min(1, dir[1]))) / Math.PI]
}

/**
 * 1 — освещено, 0 — в тени. dir — радиаль точки, sun — единичное направление НА солнце, обе в системе тела.
 * Солнце под горизонтом не пропускается: склон к солнцу за терминатором ламберт не гасит,
 * луч уходит под грунт — тень от тела и рельефа даёт сам марш.
 */
export function terrainShadowMarch(sample: HeightSampler, dir: Vec3, sun: Vec3, p: ShadowMarchParams): number {
  const R = p.radius
  const h0 = sample(terrainShadowUv(dir))
  const p0 = [dir[0] * (R + h0), dir[1] * (R + h0), dir[2] * (R + h0)]
  const texel = R * p.texelAngle
  const bias = texel * TERRAIN_SHADOW_BIAS_SLOPE
  const sMin = texel * 2
  const sMax = Math.max(p.maxDist, sMin * 2)
  const ratio = Math.pow(sMax / sMin, 1 / (TERRAIN_SHADOW_STEPS - 1))
  let s = sMin
  let occl = 0

  for (let i = 0; i < TERRAIN_SHADOW_STEPS; i++) {
    const x = p0[0] + sun[0] * s, y = p0[1] + sun[1] * s, z = p0[2] + sun[2] * s
    const r = Math.hypot(x, y, z)
    const hMap = sample(terrainShadowUv([x / r, y / r, z / r]))
    const pen = (hMap - (r - R) - bias) / Math.max(s * p.penumbraTan, 1e-6)
    occl = Math.max(occl, Math.min(Math.max(pen, 0), 1))
    if (occl >= 1) break
    s *= ratio
  }

  return 1 - occl
}

/** Атмосфера — её угловой радиус; иначе R★/dist; иначе фолбэк. Пол и softness — поверх. */
export function penumbraTan(
  sunAngularRadius: number | undefined,
  starRadiusUnits: number | undefined,
  distanceUnits: number,
  softness: number
): number {
  const raw =
    sunAngularRadius !== undefined
      ? Math.tan(sunAngularRadius)
      : starRadiusUnits !== undefined && distanceUnits > 0
        ? starRadiusUnits / distanceUnits
        : Math.tan(DEFAULT_SUN_ANGULAR_RADIUS)
  return Math.max(raw, TERRAIN_SHADOW_PENUMBRA_FLOOR) * softness
}
