/**
 * CPU-зеркало домена детали гигантов (GiantDetail.ts). Единицы: R и scale в
 * км, домен безразмерный (клетки шума). Держать синхронно с GLSL.
 */
export function giantDomain(
  dir: [number, number, number],
  radiusKm: number,
  stretch: number,
  scaleKm: number
): [number, number, number] {
  const lat = Math.asin(Math.max(-1, Math.min(1, dir[1])))
  const lon = Math.atan2(dir[2], dir[0])
  const k = radiusKm / (stretch * scaleKm)
  return [Math.cos(lon) * k, Math.sin(lon) * k, lat * stretch * k]
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Деталь гаснет к полюсам — там долгота вырождается. */
export function polarWeight(dirY: number): number {
  return 1 - smoothstep(0.85, 0.98, Math.abs(dirY))
}

/** Страховка поверх гашения октав: 1 до 0.4·F, 0 за F. */
export function distFade(viewDistance: number, fadeEnd: number): number {
  return 1 - smoothstep(0.4 * fadeEnd, fadeEnd, viewDistance)
}
