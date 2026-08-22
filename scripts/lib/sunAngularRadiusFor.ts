/**
 * Честный угловой радиус звезды для атмосферы вымышленного тела.
 *
 * Зачем. `AtmosphereConfig.sunAngularRadius` запечён в LUT Брунетона (размер
 * диска определяет мягкость терминатора и ширину сумеречной полосы), а у всех
 * вымышленных систем стояло земное число 0.00465 — «солнце как с Земли»
 * независимо от того, что Darkness сидит в 111.7 а.е., а TOI-519b — в 0.0159.
 *
 * Что считаем: `atan(R_звезды / d)`, где d — большая полуось орбиты тела
 * вокруг общего барицентра системы. Луна берёт орбиту своей планеты: её
 * собственная орбита (тысячи км) на фоне астрономических единиц не значит
 * ничего. Двойная система — ближайшее к барицентру солнце.
 *
 * Чистая функция над таблицами БД: ни рендера, ни ввода-вывода.
 */

import { AU } from '@/core/constants'
import { Actors } from '@storage/database/actors'
import { Categories } from '@storage/database/categories'
import { Orbits } from '@storage/database/orbits'
import { PhysicalObjects } from '@storage/database/physicalObjects'
import type { IActor } from '@/core/models/types'

function categoryId(alias: string): number {
  const category = Categories.find((c) => c.alias === alias)
  if (!category) throw new Error(`sunAngularRadiusFor: категории «${alias}» нет в БД`)
  return category.id
}

const STAR = categoryId('star')
const PLANET = categoryId('planet')

function actorById(id: number): IActor | undefined {
  return Actors.find((a) => a.id === id)
}

function semiMajorAxisAu(actorId: number): number | undefined {
  const orbit = Orbits.find((o) => o.actorId === actorId)
  return orbit && Number.isFinite(orbit.semiMajorAxis) ? orbit.semiMajorAxis : undefined
}

function radiusKm(actorId: number): number | undefined {
  const physical = PhysicalObjects.find((p) => p.actorId === actorId)
  return physical && Number.isFinite(physical.radius) ? physical.radius : undefined
}

/**
 * Тело, орбита которого и есть расстояние до звезды: от `actor` вверх, пока
 * родитель — планета (луна → её планета, луна луны → та же планета).
 */
function orbitalHost(actor: IActor): IActor {
  let current = actor
  for (;;) {
    const parent = current.parentId === null ? undefined : actorById(current.parentId)
    if (!parent || parent.categoryId !== PLANET) return current
    current = parent
  }
}

/**
 * Звезда системы: первая на пути вверх, а если её там нет (обычный случай —
 * тела и светила висят братьями под барицентром) — ближайшее к барицентру
 * солнце среди детей. «Ближайшее» = с наименьшей своей большой полуосью:
 * у двойной Tatoo это Tatoo I.
 */
function primaryStar(host: IActor): IActor | undefined {
  for (let node: IActor | undefined = host; node; node = node.parentId === null ? undefined : actorById(node.parentId)) {
    if (node !== host && node.categoryId === STAR) return node

    const stars = Actors.filter((a) => a.parentId === node.id && a.categoryId === STAR)
    if (stars.length > 0) {
      return stars.reduce((best, star) => ((semiMajorAxisAu(star.id) ?? Infinity) < (semiMajorAxisAu(best.id) ?? Infinity) ? star : best))
    }
  }
  return undefined
}

/**
 * Угловой радиус звезды с поверхности тела, радианы. `undefined` — если в
 * системе нет звезды (Sgr A* I вращается вокруг чёрной дыры), нет орбиты или
 * нет радиуса светила: такие атмосферы страж пропускает, а не роняет.
 */
export function sunAngularRadiusFor(bodyActorId: number): number | undefined {
  const body = actorById(bodyActorId)
  if (!body) return undefined

  const host = orbitalHost(body)
  const star = primaryStar(host)
  if (!star) return undefined

  const distanceAu = semiMajorAxisAu(host.id)
  const starRadiusKm = radiusKm(star.id)
  if (distanceAu === undefined || distanceAu <= 0 || starRadiusKm === undefined || starRadiusKm <= 0) return undefined

  return Math.atan(starRadiusKm / (distanceAu * AU))
}
