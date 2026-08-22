/**
 * CPU-зеркало uv-маппинга LUT пропускания Брунетона
 * (GetTransmittanceTextureUvFromRMu, atmosphere.ts). Единицы — км.
 * Держать синхронно с GLSL в SunTransmittance.ts.
 */
export function transmittanceUv(
  r: number,
  mu: number,
  bottom: number,
  top: number,
  width: number,
  height: number
): { u: number; v: number } {
  const H = Math.sqrt(top * top - bottom * bottom)
  const rho = Math.sqrt(Math.max(r * r - bottom * bottom, 0))
  const discriminant = r * r * (mu * mu - 1) + top * top
  const d = Math.max(-r * mu + Math.sqrt(Math.max(discriminant, 0)), 0)
  const dMin = top - r
  const dMax = rho + H
  // Ниже горизонта d выходит за d_max (x_mu > 1) — кламп к [0,1] = ClampToEdge
  // самой LUT; smoothstep солнечного диска там и так даёт 0.
  const xMu = Math.min(Math.max((d - dMin) / (dMax - dMin), 0), 1)
  const xR = rho / H
  const unit = (x: number, n: number): number => 0.5 / n + x * (1 - 1 / n)
  return { u: unit(xMu, width), v: unit(xR, height) }
}

type Vec3 = readonly [number, number, number]

function normalize3([x, y, z]: Vec3): Vec3 {
  const len = Math.sqrt(x * x + y * y + z * z) || 1
  return [x / len, y / len, z / len]
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * CPU-зеркало GLSL-выражения `dot(normalize(vLocalDir), -normalize(vLocalLightDirection))`
 * (PlanetShaderTemplate.ts) — muS для sunTint. `lightDirFromSun` направлен ОТ солнца
 * К точке (см. вершинник), поэтому знак минус: подсолнечная точка (dir совпадает с
 * направлением НА солнце) даёт muS = +1.
 */
export function subsolarMuS(dir: Vec3, lightDirFromSun: Vec3): number {
  const n = normalize3(lightDirFromSun)
  return dot3(normalize3(dir), [-n[0], -n[1], -n[2]])
}
