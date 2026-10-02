/**
 * Ближний слой тени рельефа: плитка высот вокруг подспутниковой точки камеры.
 * CPU-зеркало GLSL-марша и источник формул для печи плитки в воркере —
 * без тяжёлых импортов. Держать синхронно с шейдерным двойником.
 *
 * Плитка — касательная плоскость в центре c (единичный, тело-локально), оси E, N;
 * координаты (x, y) в метрах, проекция гномоническая. Значения — высоты над сферой
 * относительно центра плитки, метры.
 */
export const NEAR_SHADOW_STEPS = 16
/** bias = texel · это; как у дальнего слоя. */
export const NEAR_SHADOW_BIAS_SLOPE = 0.05

export type Vec3 = [number, number, number]
/** Высота плитки в точке (x, y), метры относительно центра. */
export type TileSampler = (x: number, y: number) => number

export interface NearShadowMarchParams {
  radiusMeters: number
  texelMeters: number
  maxDistanceMeters: number
  penumbraTan: number
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const normalize = (a: Vec3): Vec3 => {
  const l = Math.sqrt(dot(a, a))
  return [a[0] / l, a[1] / l, a[2] / l]
}
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** E = normalize(UP × c), N = c × E (UP = +Y); у полюса E — ось X, ортогонализованная к c. */
export function nearTileBasis(center: Vec3): { east: Vec3; north: Vec3 } {
  const c = center
  const upCrossC: Vec3 = [c[2], 0, -c[0]]
  const east = Math.hypot(upCrossC[0], upCrossC[2]) < 1e-4
    ? normalize([1 - c[0] * c[0], -c[1] * c[0], -c[2] * c[0]])
    : normalize(upCrossC)
  return { east, north: cross(c, east) }
}

/** (x, y) = R·(d·E, d·N)/(d·c), метры; d — единичный, в полусфере c. */
export function dirToTile(d: Vec3, c: Vec3, e: Vec3, n: Vec3, radiusMeters: number): [number, number] {
  const k = radiusMeters / dot(d, c)
  return [dot(d, e) * k, dot(d, n) * k]
}

/** d = normalize(c + (x·E + y·N)/R). */
export function tileToDir(x: number, y: number, c: Vec3, e: Vec3, n: Vec3, radiusMeters: number): Vec3 {
  const u = x / radiusMeters, v = y / radiusMeters
  return normalize([c[0] + e[0] * u + n[0] * v, c[1] + e[1] * u + n[1] * v, c[2] + e[2] * u + n[2] * v])
}

/** Координата центра тексела i вдоль оси, метры: столбец/строка 0 — запад/юг. */
export function texelCenter(i: number, texels: number, texelMeters: number): number {
  return (i + 0.5 - texels / 2) * texelMeters
}

/**
 * 1 — освещено, 0 — в тени. d — радиаль фрагмента, sun — единичное направление НА солнце.
 * Луч идёт по плитке вдоль проекции sun на (E, N), шаги геометрически от одного текселя
 * до maxDistanceMeters. Высота луча над сферой h₀ + s·tanθ + s²/(2R): сфера уходит
 * из-под прямой. Без раннего выхода по солнцу под горизонтом — тень даёт сам марш.
 */
export function nearShadowMarch(
  sample: TileSampler,
  d: Vec3,
  sun: Vec3,
  c: Vec3,
  e: Vec3,
  n: Vec3,
  p: NearShadowMarchParams
): number {
  const se = dot(sun, e), sn = dot(sun, n)
  const horiz = Math.hypot(se, sn)
  // Солнце в зените: направления по плитке нет, рельеф тени не кладёт.
  if (horiz < 1e-6) return 1
  const dx = se / horiz, dy = sn / horiz

  const sinT = dot(sun, d)
  const tanT = sinT / Math.max(Math.sqrt(Math.max(1 - sinT * sinT, 0)), 1e-6)
  const R = p.radiusMeters
  const [x0, y0] = dirToTile(d, c, e, n, R)
  const h0 = sample(x0, y0)

  const bias = p.texelMeters * NEAR_SHADOW_BIAS_SLOPE
  const sMin = p.texelMeters
  const sMax = Math.max(p.maxDistanceMeters, sMin * 2)
  const ratio = Math.pow(sMax / sMin, 1 / (NEAR_SHADOW_STEPS - 1))
  let s = sMin
  let occl = 0

  for (let i = 0; i < NEAR_SHADOW_STEPS; i++) {
    const hRay = h0 + s * tanT + (s * s) / (2 * R)
    const pen = (sample(x0 + dx * s, y0 + dy * s) - hRay - bias) / Math.max(s * p.penumbraTan, 1e-6)
    occl = Math.max(occl, Math.min(Math.max(pen, 0), 1))
    if (occl >= 1) break
    s *= ratio
  }

  return 1 - occl
}

/** 1 ниже fadeMeters, 0 выше maxMeters, smoothstep между. */
export function nearAltitudeWeight(altitudeMeters: number, fadeMeters: number, maxMeters: number): number {
  return 1 - smoothstep(fadeMeters, maxMeters, altitudeMeters)
}

/** 1 внутри 0.8·half, 0 на краю плитки, по max(|x|, |y|). */
export function nearEdgeWeight(x: number, y: number, halfMeters: number): number {
  return 1 - smoothstep(0.8 * halfMeters, halfMeters, Math.max(Math.abs(x), Math.abs(y)))
}

/** min(far, mix(1, near, weight)); порядок как у GLSL mix — при weight = 0 ровно far, при 1 ровно min(far, near). */
export function combineTerrainShadow(far: number, near: number, weight: number): number {
  return Math.min(far, (1 - weight) + near * weight)
}
