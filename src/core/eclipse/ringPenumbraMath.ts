/** Веса треугольного ядра полутени тени колец (сумма 9). */
export const RING_PENUMBRA_WEIGHTS: readonly number[] = [1, 2, 3, 2, 1]

/**
 * Пропускание тени кольца: 5 выборок альфы по радиусу кольца в u ± {0, ½, 1}·du,
 * вне [0, 1] — прозрачно (маска, как в GLSL); при du = 0 — прежняя одна выборка.
 */
export function ringShadowTransmission(u: number, du: number, alphaAt: (u: number) => number): number {
  let opacity = 0
  RING_PENUMBRA_WEIGHTS.forEach((w, k) => {
    const uk = u + (k - 2) * 0.5 * du
    const a = uk >= 0 && uk <= 1 ? alphaAt(uk) : 0
    opacity += w * a
  })
  return 1 - opacity / 9
}
