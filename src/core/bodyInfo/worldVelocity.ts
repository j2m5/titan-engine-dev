import { Vector3 } from 'three'
import type { Actor } from '@/core/models/Actor'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { AU, DAY } from '@/core/constants'

/** Полушаг центральной разности, сутки: ошибка ~(ω·h)² — у Фобоса 6·10⁻⁵ */
const HALF_STEP_DAYS: number = 5e-4

/**
 * Скорость по орбите — производная той же позиции, по которой движется узел
 * сцены. velocity из getStateByEpoch считается по массам и у барицентрических
 * подорбит с явным периодом не совпадает с движением: Земля вокруг барицентра
 * Земля–Луна вышла бы ~13 км/с вместо 12 м/с.
 */
function orbitalVelocity(actor: Actor, epoch: number): Vector3 {
  const model: KeplerianModel = new KeplerianModel(actor)
  const ahead: Vector3 = model.getStateByEpoch(epoch + HALF_STEP_DAYS).position
  const behind: Vector3 = model.getStateByEpoch(epoch - HALF_STEP_DAYS).position

  return ahead.sub(behind).divideScalar(2 * HALF_STEP_DAYS)
}

/**
 * Скорость тела в мировой системе, а.е./сутки, координаты three: сумма
 * орбитальных скоростей по цепочке родителей — так же складываются позиции
 * узлов сцены. Узел без орбиты (размещение, корень) вносит ноль.
 */
export function worldVelocity(actor: Actor, epoch: number): Vector3 {
  const velocity: Vector3 = new Vector3()

  for (let node: Actor | null = actor; node; node = node.parent) {
    if (node.orbit) velocity.add(orbitalVelocity(node, epoch))
  }

  return velocity
}

/** Скорость тела относительно другого, км/с */
export function relativeSpeedKms(actor: Actor, other: Actor, epoch: number): number {
  return (worldVelocity(actor, epoch).sub(worldVelocity(other, epoch)).length() * AU) / DAY
}
