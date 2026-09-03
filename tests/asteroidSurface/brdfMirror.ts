/**
 * CPU-зеркало GLSL-чанка AsteroidBrdf (src/core/materials/shaders/lib/chunks/AsteroidBrdf.ts).
 * Менять строго синхронно: GLSL обязан повторять эти формулы один в один.
 */

/** Ширина оппозиционного пика, рад (зеркало константы чанка) */
export const OPPOSITION_WIDTH = 0.1

/**
 * Диффуз реголита: смесь Ламберта и Ломмеля-Зелигера (lunarMix), нормирована в
 * лоб (NdotL = NdotV = 1 → 1 без пика), плюс оппозиционный пик по фазовому углу
 * g = acos(cosPhase), cosPhase = dot(L, V).
 */
export function regolithDiffuse(
  NdotL: number,
  NdotV: number,
  cosPhase: number,
  lunarMix: number,
  surge: number
): number {
  const nl = Math.max(NdotL, 0)
  const nv = Math.max(NdotV, 0)
  const lambert = nl
  const lommel = (2 * nl) / Math.max(nl + nv, 1e-4)
  const diffuse = lambert + (lommel - lambert) * lunarMix
  const g = Math.acos(Math.min(1, Math.max(-1, cosPhase)))
  const opposition = 1 + surge * Math.exp(-g / OPPOSITION_WIDTH)
  return diffuse * opposition
}

/**
 * Planetshine: множитель альбедо от планеты в начале ring-local.
 * nDotP — косинус между нормалью и направлением на центр планеты (в одном
 * пространстве), ringPos — позиция фрагмента в ring-local, lightDirRing —
 * направление на звезду в ring-local, planetRadius — в тех же единицах.
 */
export function planetshine(
  nDotP: number,
  ringPos: [number, number, number],
  lightDirRing: [number, number, number],
  planetRadius: number
): number {
  const d = Math.hypot(ringPos[0], ringPos[1], ringPos[2])
  if (planetRadius <= 0 || d <= planetRadius) return 0
  const pHat = [ringPos[0] / d, ringPos[1] / d, ringPos[2] / d]
  const phase = 0.5 * (1 + pHat[0] * lightDirRing[0] + pHat[1] * lightDirRing[1] + pHat[2] * lightDirRing[2])
  const angR = planetRadius / d
  const solid = angR * angR
  const wrap = angR
  const wrapped = Math.max(nDotP + wrap, 0) / (1 + wrap)
  return phase * solid * wrapped
}
