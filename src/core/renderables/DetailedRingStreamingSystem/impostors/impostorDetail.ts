export function detailEndDistance(l0Distance: number, sectorRadius: number): number {
  return Math.max(0, l0Distance - sectorRadius)
}

export function asteroidDetailWeight(distance: number, endDistance: number, detailMix: number, startFraction: number): number {
  if (endDistance <= 0) return 1
  const start = Math.max(0, Math.min(startFraction, 0.999999)) * endDistance
  const t = Math.max(0, Math.min(1, (distance - start) / (endDistance - start)))
  return (1 - t * t * (3 - 2 * t)) * Math.max(0, Math.min(1, detailMix))
}

export function advanceDetailMix(current: number, target: number, delta: number, speed: number): number {
  if (delta <= 0 || current === target) return current
  const step = Math.max(0, speed) * delta
  return current < target ? Math.min(current + step, target) : Math.max(current - step, target)
}
