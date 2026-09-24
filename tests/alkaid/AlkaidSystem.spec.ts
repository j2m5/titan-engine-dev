import { describe, it, expect } from 'vitest'
import { Actors, Orbits, PhysicalObjects, RenderingObjects, RotationObjects } from '@storage/database'
import { Scenarios } from '@/config/scenarios'
import { colorTemperatureToRGB } from '@/core/materials/shaders/lib/helpers'

/** Актор по имени; имена сцены Алькаид уникальны в базе */
const actorByName = (name: string) => {
  const actor = Actors.find((a) => a.name === name)
  expect(actor, `актор «${name}» не найден`).toBeDefined()
  return actor!
}
const physicalOf = (actorId: number) => PhysicalObjects.find((p) => p.actorId === actorId)!
const orbitOf = (actorId: number) => Orbits.find((o) => o.actorId === actorId)!
const renderingOf = (actorId: number) => RenderingObjects.find((r) => r.actorId === actorId)!

describe('сцена Алькаид: система и звезда', () => {
  it('барицентр без родителя, звезда категории 3 под ним', () => {
    const system = actorByName('Alkaid system')
    const star = actorByName('Alkaid')

    expect(system.categoryId).toBe(1)
    expect(system.parentId).toBeNull()
    expect(star.categoryId).toBe(3)
    expect(star.parentId).toBe(system.id)
  })

  it('звезда B3 V: 15 540 К, 3.4 R☉, 6.1 M☉; физика звезды — под физикой системы', () => {
    const star = physicalOf(actorByName('Alkaid').id)
    const system = physicalOf(actorByName('Alkaid system').id)

    expect(star.temperature).toBe(15540)
    expect(star.radius).toBe(2365380)
    expect(star.mass).toBeCloseTo(1.213e31, -27)
    expect(star.parentId).toBe(system.id)
    expect(system.parentId).toBeNull()
  })

  it('цвет света по формуле движка — бело-голубой: синий канал 255, красный ниже 190 и ниже зелёного', () => {
    const c = colorTemperatureToRGB(physicalOf(actorByName('Alkaid').id).temperature)

    expect(c.b).toBe(255)
    expect(c.r).toBeLessThan(190)
    expect(c.r).toBeLessThan(c.g)
  })

  it('строка rendering звезды несёт только тинт света в (0, 1]', () => {
    const data = renderingOf(actorByName('Alkaid').id).data as { lightTint?: number }

    expect(Object.keys(data)).toEqual(['lightTint'])
    expect(data.lightTint).toBeGreaterThan(0)
    expect(data.lightTint).toBeLessThanOrEqual(1)
  })

  it('строка вращения звезды: период в часах положителен, наклон небольшой', () => {
    const row = RotationObjects.find((r) => r.actorId === actorByName('Alkaid').id)

    expect(row).toBeDefined()
    expect(row!.period).toBeGreaterThan(0)
    expect(row!.inclination).toBeLessThan(30)
  })

  it('сценарий: корень — барицентр, источник света — звезда, id уникален', () => {
    const system = actorByName('Alkaid system')
    const scenario = Scenarios.find((s) => s.rootId === system.id)

    expect(scenario).toBeDefined()
    expect(scenario!.lightSources).toEqual([actorByName('Alkaid').id])
    expect(scenario!.skybox).toEqual([1, 2, 3, 4, 5, 6])
    expect(Scenarios.filter((s) => s.id === scenario!.id)).toHaveLength(1)
  })
})

export { actorByName, physicalOf, orbitOf, renderingOf }
