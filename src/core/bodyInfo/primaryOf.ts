import type { Actor } from '@/core/models/Actor'

const BARYCENTER_ALIAS: string = 'barycenter'

function isBarycenter(actor: Actor): boolean {
  return actor.category?.getAttribute('alias') === BARYCENTER_ALIAS
}

function massOf(actor: Actor): number {
  return actor.physicalObject?.getAttribute('mass', 0) ?? 0
}

/**
 * Главное тело — то, вокруг чего тело обращается по смыслу, а не по строке
 * орбиты. У барицентрических подорбит родитель — барицентр: тело обращается
 * вокруг самого массивного члена системы (Луна → Земля), а если само им
 * является — вокруг главного тела уровнем выше (Земля → Солнце). Барицентры
 * в кандидаты не идут: у части из них условный физобъект.
 */
export function primaryOf(actor: Actor): Actor | null {
  let node: Actor = actor

  for (let parent: Actor | null = node.parent; parent; node = parent, parent = parent.parent) {
    if (!isBarycenter(parent)) return parent

    const heaviest: Actor | null = parent.children
      .all()
      .filter((child: Actor): boolean => !isBarycenter(child) && child.physicalObject !== null)
      .reduce<Actor | null>(
        (best: Actor | null, child: Actor) => (best === null || massOf(child) > massOf(best) ? child : best),
        null
      )

    if (heaviest && heaviest.getAttribute('id') !== node.getAttribute('id')) return heaviest
  }

  return null
}
