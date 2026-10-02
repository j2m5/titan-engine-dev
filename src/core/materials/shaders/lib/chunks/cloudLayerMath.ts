// CPU-зеркало чанка CloudLayer (облачный слой на высоте h над датумом). Без импортов three:
// чистые функции над кортежами. GLSL-двойник обязан совпадать формулами.

export type Vec3 = [number, number, number]

/** Кламп косинуса взгляда в утолщении: у самого лимба путь сквозь слой конечен. */
export const CLOUD_SLANT_MIN_MU = 0.1
/** Кап косинуса зенитного угла в сдвиге тени облаков: без разлёта у терминатора. */
export const CLOUD_SHADOW_MIN_COS = 0.15

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

/**
 * Точка слоя на луче взгляда: от P = R·dir назад к камере до сферы R + h.
 * view — единичный от камеры к точке; разность квадратов радиусов — h·(2R + h) (точность float32).
 */
export function cloudLayerPoint(dir: Vec3, view: Vec3, radius: number, height: number): Vec3 {
  if (height <= 0) return dir
  const p: Vec3 = [dir[0] * radius, dir[1] * radius, dir[2] * radius]
  const b = dot(p, view)
  const t = b + Math.sqrt(Math.max(b * b + height * (2 * radius + height), 0))
  return normalize([p[0] - t * view[0], p[1] - t * view[1], p[2] - t * view[2]])
}

/** Покрытие с утолщением у края: 1 − (1 − α)^(1/max(μv, 0.1)); 0 и 1 — неподвижные точки. */
export function cloudSlantAlpha(alpha: number, muV: number): number {
  return 1 - Math.pow(Math.max(1 - alpha, 0), 1 / Math.max(muV, CLOUD_SLANT_MIN_MU))
}

/** Понижение горизонта для облака на высоте h: sin угла, на который солнце видно дольше земли. */
export function cloudDip(radius: number, height: number): number {
  const h = Math.max(height, 0)
  return Math.sqrt(h * (2 * radius + h)) / (radius + h)
}

/** Свет в точке слоя: (μs + k)/(1 + k), k = dip + мягкость; кламп [0, 1]. */
export function cloudSunLight(cloudDir: Vec3, sun: Vec3, radius: number, height: number, softness: number): number {
  const k = cloudDip(radius, height) + softness
  return Math.min(Math.max((dot(cloudDir, sun) + k) / (1 + k), 0), 1)
}

/**
 * Сдвиг uv тени облака: облако, затеняющее точку, стоит по направлению к солнцу на h·tan θ;
 * sunTangent — касательная проекция направления на солнце в базисе (east, north) (длины в единицах),
 * u делится на 2πR·cos φ, v — на πR. cos θ клампится снизу — без разлёта у терминатора.
 */
export function cloudShadowUvOffset(
  sunTangentEN: [number, number],
  muS: number,
  heightUnits: number,
  radiusUnits: number,
  cosLat: number
): { du: number; dv: number } {
  const cosZ = Math.max(muS, CLOUD_SHADOW_MIN_COS)
  const scale = heightUnits / cosZ
  return {
    du: (sunTangentEN[0] * scale) / (2 * Math.PI * radiusUnits * Math.max(cosLat, 1e-3)),
    dv: (sunTangentEN[1] * scale) / (Math.PI * radiusUnits)
  }
}
