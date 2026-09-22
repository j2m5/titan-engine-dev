/** smoothstep как в GLSL: гладкая интерполяция, нулевые производные на краях */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Кроссфейд дальнего слоя точек и L1-биллбордов стримера у порога Near
 * (distance — distanceToTorus, см. beltDistance): точки гаснут ВНУТРЬ тора,
 * L1 — НАРУЖУ (спека §4). Полоса перехода — [nearThreshold·0.5, nearThreshold·1.5].
 *
 * streamerL1Fade — ровно дополнение до 1: сумма тождественно 1 при любой
 * дистанции. L1-биллборды используют СВОЙ per-instance fade (uMaxDistance,
 * см. BILLBOARD_VERTEX_SHADER) — эта функция не подключена к их шейдеру,
 * она лишь проверяет, что форма кроссфейда согласована (тест на инвариант).
 */
export function pointLayerFade(distance: number, nearThreshold: number): number {
  return smoothstep(nearThreshold * 0.5, nearThreshold * 1.5, distance)
}

export function streamerL1Fade(distance: number, nearThreshold: number): number {
  return 1 - pointLayerFade(distance, nearThreshold)
}
