import { describe, it, expect } from 'vitest'
import type { Actor } from '@/core/models/Actor'
import { resolveLightSource } from '@/core/helpers/lightSource'
import { resolveStarRadiusKm } from '@/core/terrain/starRadius'
import { LIGHT_SOURCE_CATEGORY_IDS, STAR_CATEGORY_ID, GIANT_STAR_CATEGORY_ID } from '@/core/constants'

interface StubSpec {
  categoryId: number
  radius?: number
  children?: StubSpec[]
}

/** Минимальное дерево акторов: parent, children.where(...).first(), physicalObject */
function tree(spec: StubSpec, parent: Actor | null = null): Actor {
  const kids: Actor[] = []
  const actor = {
    parent,
    getAttribute: (key: string): unknown => (key === 'categoryId' ? spec.categoryId : undefined),
    physicalObject: { getAttribute: (key: string): unknown => (key === 'radius' ? spec.radius : undefined) },
    children: {
      where: (key: string, value: number) => ({
        first: (): Actor | undefined => kids.find((k) => k.getAttribute(key as never) === value)
      })
    }
  } as unknown as Actor

  for (const child of spec.children ?? []) kids.push(tree(child, actor))
  ;(actor as unknown as { kids: Actor[] }).kids = kids

  return actor
}

const kidsOf = (actor: Actor): Actor[] => (actor as unknown as { kids: Actor[] }).kids

describe('список категорий-светил', () => {
  it('звезда и звезда-гигант — и только они', () => {
    // Карлики и чёрная дыра не входят осознанно: под ними стоят принятые тела,
    // у которых иначе молча сменилась бы полутень теней рельефа
    expect([...LIGHT_SOURCE_CATEGORY_IDS]).toEqual([STAR_CATEGORY_ID, GIANT_STAR_CATEGORY_ID])
    expect(GIANT_STAR_CATEGORY_ID).toBe(10)
  })
})

describe('resolveLightSource', () => {
  it('корень дерева сам звезда', () => {
    const root = tree({ categoryId: 3, radius: 695700, children: [{ categoryId: 4 }] })

    expect(resolveLightSource(kidsOf(root)[0])).toBe(root)
  })

  it('звезда — прямой ребёнок корня-барицентра', () => {
    const root = tree({ categoryId: 1, children: [{ categoryId: 3, radius: 1 }, { categoryId: 4 }] })

    expect(resolveLightSource(kidsOf(root)[1])).toBe(kidsOf(root)[0])
  })

  it('звезда-гигант находится так же, и от спутника планеты тоже', () => {
    const root = tree({
      categoryId: 1,
      children: [{ categoryId: 10, radius: 1.06e9 }, { categoryId: 4, children: [{ categoryId: 4 }] }]
    })
    const moon = kidsOf(kidsOf(root)[1])[0]

    expect(resolveLightSource(moon)).toBe(kidsOf(root)[0])
  })

  it('обычная звезда главнее гиганта в одном дереве — порядок списка', () => {
    const root = tree({ categoryId: 1, children: [{ categoryId: 10 }, { categoryId: 3 }, { categoryId: 4 }] })

    expect(resolveLightSource(kidsOf(root)[2])).toBe(kidsOf(root)[1])
  })

  it('карлик и чёрная дыра светилом не считаются', () => {
    for (const categoryId of [2, 8, 9]) {
      const root = tree({ categoryId: 1, children: [{ categoryId }, { categoryId: 4 }] })

      expect(resolveLightSource(kidsOf(root)[1])).toBeUndefined()
    }
  })

  it('стаб-актор без parent и children не роняет поиск', () => {
    expect(resolveLightSource({} as unknown as Actor)).toBeUndefined()
  })
})

describe('resolveStarRadiusKm поверх резолвера', () => {
  it('для обычной звезды значение прежнее', () => {
    const root = tree({ categoryId: 1, children: [{ categoryId: 3, radius: 800055 }, { categoryId: 4 }] })

    expect(resolveStarRadiusKm(kidsOf(root)[1])).toBe(800055)
  })

  it('под звездой-гигантом радиус находится', () => {
    const root = tree({ categoryId: 1, children: [{ categoryId: 10, radius: 1.06e9 }, { categoryId: 4 }] })

    expect(resolveStarRadiusKm(kidsOf(root)[1])).toBe(1.06e9)
  })

  it('нет светила или радиус не положителен — undefined (фолбэк полутени)', () => {
    const dwarf = tree({ categoryId: 1, children: [{ categoryId: 9, radius: 5850 }, { categoryId: 4 }] })
    const zero = tree({ categoryId: 1, children: [{ categoryId: 3, radius: 0 }, { categoryId: 4 }] })

    expect(resolveStarRadiusKm(kidsOf(dwarf)[1])).toBeUndefined()
    expect(resolveStarRadiusKm(kidsOf(zero)[1])).toBeUndefined()
  })
})
