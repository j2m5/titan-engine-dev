import type { Actor } from '@/core/models/Actor'
import { KeplerianModel } from '@/core/libs/KeplerianModel'

const BARYCENTER_ALIAS: string = 'barycenter'
/** Доля массы членов барицентра, с которой самый тяжёлый считается центром (Солнце, Земля, Sgr A*) */
const DOMINANT_MASS_SHARE: number = 0.9
/** Относительный допуск равенства периодов пары: у пар в данных период явный и общий */
const PAIR_PERIOD_TOLERANCE: number = 1e-6

function isBarycenter(actor: Actor): boolean {
  return actor.category?.getAttribute('alias') === BARYCENTER_ALIAS
}

function massOf(actor: Actor): number {
  return actor.physicalObject?.getAttribute('mass', 0) ?? 0
}

/** Пара — два члена барицентра с общим периодом обращения вокруг него (Луна–Земля, Tatoo II–Tatoo I) */
function isPair(a: Actor, b: Actor): boolean {
  if (!a.orbit || !b.orbit) return false

  const periodA: number = new KeplerianModel(a).period
  const periodB: number = new KeplerianModel(b).period

  return periodB > 0 && Math.abs(periodA - periodB) / periodB < PAIR_PERIOD_TOLERANCE
}

/**
 * Обращение тела по смыслу, а не по строке орбиты:
 * - primary — вокруг чего тело обращается; null — тело само центр системы;
 * - orbiter — чья орбита это обращение описывает: само тело или барицентр,
 *   в который оно входит (у Земли — барицентр Земля–Луна вокруг Солнца);
 * - pair — второй член пары с общим периодом: относительная орбита пары —
 *   сумма их полуосей вокруг барицентра (Луна–Земля).
 */
export interface OrbitalContext {
  primary: Actor | null
  orbiter: Actor
  pair: Actor | null
}

/**
 * У барицентрических подорбит родитель — барицентр. Самый массивный член
 * системы — главное тело, только если доминирует по массе (Солнце, Земля)
 * или образует с телом пару (Харон–Плутон, Tatoo II–Tatoo I); иначе тело
 * обращается вокруг самого барицентра (планеты двойной звезды Tatoo). Если
 * тело само самое массивное — обходим уровнем выше (Земля → Солнце).
 * Барицентры в кандидаты не идут: у части из них условный физобъект.
 */
export function orbitalContext(actor: Actor): OrbitalContext {
  let node: Actor = actor
  let parent: Actor | null = actor.parent

  while (parent) {
    if (!isBarycenter(parent)) return { primary: parent, orbiter: node, pair: null }

    const members: Actor[] = parent.children
      .all()
      .filter((child: Actor): boolean => !isBarycenter(child) && child.physicalObject !== null)
    const heaviest: Actor | null = members.reduce<Actor | null>(
      (best: Actor | null, child: Actor) => (best === null || massOf(child) > massOf(best) ? child : best),
      null
    )

    if (heaviest && heaviest.getAttribute('id') !== node.getAttribute('id')) {
      if (isPair(node, heaviest)) return { primary: heaviest, orbiter: node, pair: heaviest }

      const totalMass: number = members.reduce((sum: number, child: Actor) => sum + massOf(child), 0)
      const primary: Actor = massOf(heaviest) >= DOMINANT_MASS_SHARE * totalMass ? heaviest : parent

      return { primary, orbiter: node, pair: null }
    }

    // Тело само самое массивное в своём барицентре — обращается вместе с ним уровнем выше
    node = parent
    parent = parent.parent
  }

  return { primary: null, orbiter: actor, pair: null }
}

/** Главное тело — вокруг чего тело обращается по смыслу (см. orbitalContext) */
export function primaryOf(actor: Actor): Actor | null {
  return orbitalContext(actor).primary
}
