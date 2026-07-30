import { describe, it, expect } from 'vitest'
import { Actor } from '@/core/models/Actor'
import { Resource } from '@/core/models/Resource'

/** Категории, которые наблюдает SceneObserver (SceneObserver.ts:23). */
const OBSERVED_CATEGORY_IDS: number[] = [2, 3, 4] // blackHole, star, planet

describe('данные: lifecycle ресурсов', () => {
  it('каждый streamable-ресурс принадлежит актору наблюдаемой категории', () => {
    // Иначе он недостижим для политики стриминга: приоритет считается только
    // для тел из SceneObserver.data, а туда попадают лишь эти три категории.
    const unreachable: string[] = []

    for (const actor of Actor.all().toArray()) {
      const categoryId = actor.getAttribute('categoryId')

      if (typeof categoryId === 'number' && OBSERVED_CATEGORY_IDS.includes(categoryId)) continue

      for (const resource of actor.resources.toArray()) {
        if (resource.getAttribute('lifecycle') === 'streamable') {
          unreachable.push(`${actor.getAttribute('name', '?')} → ${resource.getAttribute('path', '?')}`)
        }
      }
    }

    expect(unreachable).toEqual([])
  })

  it('все кольцевые текстуры резидентны', () => {
    const rings = Resource.all()
      .filter((resource: Resource): boolean => /_rings\./.test(resource.getAttribute('path', '')))
      .map((resource: Resource): string => resource.getAttribute('lifecycle') ?? '')
      .toArray()

    expect(rings.length).toBeGreaterThan(0)
    expect(rings.every((lifecycle: string): boolean => lifecycle === 'resident')).toBe(true)
  })
})
