import { Actors, RenderingObjects } from '@storage/database'
import { ATMOSPHERE_CATEGORY_ID } from '@/core/constants'
import { sunAngularRadiusFor } from '../../scripts/lib/sunAngularRadiusFor'

/** Корень дерева акторов: система, к которой принадлежит тело. */
function rootOf(actorId: number): number {
  let current = Actors.find((a) => a.id === actorId)
  while (current && current.parentId !== null) {
    const parent = Actors.find((a) => a.id === current!.parentId)
    if (!parent) break
    current = parent
  }
  return current?.id ?? actorId
}

/** Барицентр Солнечной системы: её атмосферы держат реальные числа Horizons. */
const SOLAR_SYSTEM_ROOT = 1

/** Атмосферы вымышленных систем: [актор атмосферы, актор тела, заявленный угол]. */
const foreignAtmospheres = Actors.filter(
  (a) => a.categoryId === ATMOSPHERE_CATEGORY_ID && a.parentId !== null && rootOf(a.id) !== SOLAR_SYSTEM_ROOT
).map((a) => {
  const row = RenderingObjects.find((r) => r.actorId === a.id)
  const declared = (row as unknown as { data?: { sunAngularRadius?: number } } | undefined)?.data?.sunAngularRadius
  return { name: a.name, bodyActorId: a.parentId!, declared }
})

describe('sunAngularRadius вымышленных атмосфер — по орбите тела и радиусу звезды', () => {
  it('вымышленных атмосфер десять и у каждой заявлен угол', () => {
    expect(foreignAtmospheres).toHaveLength(10)
    for (const atmosphere of foreignAtmospheres) {
      expect(typeof atmosphere.declared, atmosphere.name).toBe('number')
    }
  })

  // Допуск 1e-3 относительный: в БД лежит округление до шести значащих
  it.each(foreignAtmospheres.map((a) => [a.name, a] as const))('%s: угол сходится с расчётным', (_name, atmosphere) => {
    const expected = sunAngularRadiusFor(atmosphere.bodyActorId)
    if (expected === undefined) {
      // Sgr A* I: в системе нет звезды, только чёрная дыра — считать не из чего
      expect(atmosphere.name).toBe('Sgr A* I')
      return
    }
    expect(Math.abs(atmosphere.declared! - expected) / expected).toBeLessThan(1e-3)
  })

  it('без звезды в системе функция честно молчит', () => {
    expect(sunAngularRadiusFor(44)).toBeUndefined() // Sgr A* I — вокруг чёрной дыры
    expect(sunAngularRadiusFor(999999)).toBeUndefined()
  })

  it('луна берёт орбиту своей планеты, а не свою', () => {
    expect(sunAngularRadiusFor(83)).toBe(sunAngularRadiusFor(82)) // Yavin IV и Yavin Prime
    expect(sunAngularRadiusFor(73)).toBe(sunAngularRadiusFor(64)) // Adriana III и Adriana
  })

  it('двойная система: солнце ближайшее к барицентру (Tatoo I, R = 835200 км)', () => {
    expect(sunAngularRadiusFor(62)).toBeCloseTo(Math.atan(835200 / (1.5 * 149597870)), 12)
  })
})
