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
  // discriminant для (bottom, top) не уходит в минус, поэтому клампим x_mu
  // явно: ниже горизонта датума d уходит за d_max, u не должен покидать 1-й тексель.
  const xMu = Math.min(Math.max((d - dMin) / (dMax - dMin), 0), 1)
  const xR = rho / H
  const unit = (x: number, n: number): number => 0.5 / n + x * (1 - 1 / n)
  return { u: unit(xMu, width), v: unit(xR, height) }
}
