import type { Vector3 } from 'three'

/** Три состояния обзора пояса по расстоянию до тора (см. distanceToTorus) */
export enum BeltLodState {
  /** Внутри/вблизи — стример с тремя тирами (L0/Near/L1) */
  Near = 'Near',
  /** Средняя дистанция — стример спит, виден только дальний слой */
  Mid = 'Mid',
  /** Издалека — стример ещё не создан */
  Far = 'Far'
}

export interface BeltLodThresholds {
  near: number
  mid: number
}

/**
 * Расстояние от точки до ПОВЕРХНОСТИ тора (0 — точка внутри), в тех же
 * единицах, что радиусы и halfThickness. Радиальная составляющая — разность
 * до ближайшей границы [innerRadius, outerRadius]; высотная — превышение над
 * половиной толщины; итог — гипотенуза (внутри обеих границ сразу — ноль).
 */
export function distanceToTorus(
  cameraLocal: Vector3,
  innerRadius: number,
  outerRadius: number,
  halfThickness: number
): number {
  const radial = Math.hypot(cameraLocal.x, cameraLocal.z)
  const radialClamped = Math.min(Math.max(radial, innerRadius), outerRadius)
  const radialExcess = Math.abs(radial - radialClamped)
  const heightExcess = Math.max(0, Math.abs(cameraLocal.y) - halfThickness)

  return Math.hypot(radialExcess, heightExcess)
}

/**
 * Следующее состояние LOD с гистерезисом: у каждого порога — полоса
 * ±hysteresis, внутри которой состояние не меняется. Проверка ведётся от
 * ТЕКУЩЕГО состояния (не от голых порогов), поэтому ровно на пороге — не
 * мигает независимо от того, откуда пришли.
 */
export function nextState(
  current: BeltLodState,
  distance: number,
  thresholds: BeltLodThresholds,
  hysteresis: number = 0.1
): BeltLodState {
  const { near, mid } = thresholds
  const nearHi = near * (1 + hysteresis)
  const nearLo = near * (1 - hysteresis)
  const midHi = mid * (1 + hysteresis)
  const midLo = mid * (1 - hysteresis)

  switch (current) {
    case BeltLodState.Near:
      if (distance > midHi) return BeltLodState.Far
      if (distance > nearHi) return BeltLodState.Mid
      return BeltLodState.Near

    case BeltLodState.Mid:
      if (distance > midHi) return BeltLodState.Far
      if (distance < nearLo) return BeltLodState.Near
      return BeltLodState.Mid

    case BeltLodState.Far:
      if (distance < nearLo) return BeltLodState.Near
      if (distance < midLo) return BeltLodState.Mid
      return BeltLodState.Far
  }
}
