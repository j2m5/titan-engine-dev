/** Шаг m к цели за delta секунд; seconds ≤ 0 — сразу цель. */
export function stepMorph(m: number, target: 0 | 1, deltaSeconds: number, seconds: number): number {
  if (seconds <= 0) return target

  const step = deltaSeconds / seconds
  return target > m ? Math.min(target, m + step) : Math.max(target, m - step)
}
