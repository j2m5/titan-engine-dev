import { describe, it, expect } from 'vitest'
import { BlackHole } from '@/core/renderables/BlackHole/BlackHole'
import { LensRegistry } from '@/core/services/LensRegistry'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'

function stubActor(): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'mass' ? 8.54e36 : def)
    },
    renderingObject: null,
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'Sagittarius A*' : def)
  } as unknown as Actor
}

const background = { name: 'sky' } as never
const observer = { sceneBackground: background } as unknown as ResourceObserver

describe('BlackHole: регистрация линзы', () => {
  it('при создании встаёт в реестр с rsVisual и радиусом зоны в юнитах и кубмапой наблюдателя; dispose снимает', () => {
    const registry = new LensRegistry()
    const hole = new BlackHole(stubActor(), observer, registry)

    expect(registry.size).toBe(1)
    const entry = registry.entries()[0]
    expect(entry.object).toBe(hole)
    expect(entry.rsUnits).toBeCloseTo(toThreeJSUnits(hole.parameters.rsVisual), 12)
    expect(entry.simulationRadiusUnits).toBe(hole.parameters.simulationRadiusUnits)
    expect(entry.background()).toBe(background)

    hole.dispose()
    hole.dispose()
    expect(registry.size).toBe(0)
  })

  it('без реестра (тестовые сборки) дыра строится и dispose безвреден', () => {
    const hole = new BlackHole(stubActor(), observer)
    expect(() => hole.dispose()).not.toThrow()
  })
})
