import { describe, it, expect } from 'vitest'
import { SphereGeometry } from 'three'
import { BlackHole, MESH_MARGIN } from '@/core/renderables/BlackHole/BlackHole'
import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'
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

  it('меш описан вокруг аналитической сферы, а лишнее режет discard: между гранями и сферой нет кольца без сдвига', () => {
    const hole = new BlackHole(stubActor(), observer)
    const geometry = hole.geometry as SphereGeometry

    // Многогранник с 64×32 сегментами лежит внутри сферы до 0.5 % радиуса — поднимаем его над ней
    expect(geometry.parameters.radius / hole.parameters.simulationRadiusUnits).toBeCloseTo(MESH_MARGIN, 9)
    expect(MESH_MARGIN).toBeGreaterThan(1 / (Math.cos(Math.PI / 64) * Math.cos(Math.PI / 32)))
    expect(BlackHoleShaderTemplate.fragmentShader).toContain('if (!cameraInside && b > simulationRs) discard;')
  })

  it('без реестра (тестовые сборки) дыра строится и dispose безвреден', () => {
    const hole = new BlackHole(stubActor(), observer)
    expect(() => hole.dispose()).not.toThrow()
  })
})
