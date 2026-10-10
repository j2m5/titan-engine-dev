import { smoothstep } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'

/** Расстояния от центра в наружных радиусах диска: начало усиления и его предел */
const NEAR_DISK_RADII: number = 1.25
const FAR_DISK_RADII: number = 128

/** Общая эмиссия L0/L1 по расстоянию до камеры в единицах Three.js */
export function blackHoleDiskIntensity(parameters: BlackHoleParameters, distance: number): number {
  const radii: number = Math.max(distance / toThreeJSUnits(parameters.diskOuterRadius), NEAR_DISK_RADII)
  // Логарифмическая шкала распределяет рост по последовательным удвоениям расстояния
  const farWeight: number = smoothstep(Math.log(radii / NEAR_DISK_RADII), 0, Math.log(FAR_DISK_RADII / NEAR_DISK_RADII))

  return parameters.diskIntensity * (1 + (parameters.diskFarGain - 1) * farWeight)
}
