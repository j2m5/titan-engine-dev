import { Object3D } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'

export type Collider = {
  object: Object3D
  radius: number
}

/** Минимальная дистанция камеры до центра тела = R × COLLISION_GAP: зазор — задел под будущий рельеф поверхностей. */
export const COLLISION_GAP = 1.001

/**
 * Сферы-коллайдеры из снапшота наблюдаемых тел.
 *
 * Чёрная дыра пропускается намеренно (решение владельца — объект уникальный,
 * коллизии для него отложены). Тело без модели или радиуса — молча: в кэш не
 * попадает то, для чего сферу построить не из чего. Дубли одного актора
 * (LOD-уровни и импостор находятся поиском по userData.type и делят модель)
 * схлопываются, иначе одно тело выталкивало бы камеру дважды.
 */
export function collectColliders(objects: Object3D[]): Collider[] {
  const colliders: Collider[] = []
  const seen = new Set<object>()

  for (const object of objects) {
    if (object.userData.type === 'blackHole') continue

    const model = object.model
    if (!model) continue
    if (seen.has(model)) continue

    const radius = model.physicalObject?.getAttribute('radius')
    if (typeof radius !== 'number' || radius <= 0) continue

    seen.add(model)
    colliders.push({ object, radius: toThreeJSUnits(radius) * COLLISION_GAP })
  }

  return colliders
}
