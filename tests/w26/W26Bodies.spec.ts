import { describe, it, expect } from 'vitest'
import { Actors, PhysicalObjects, Orbits, RenderingObjects, Resources, ActorResource } from '@storage/database'
import { validateProceduralSurface } from '@/core/terrain/proceduralSurfaceParams'

const AU_KM: number = 149597870.7
const SYSTEM: string = 'Westerlund 1-26 system'

const actor = (name: string) => {
  const found = Actors.find((a) => a.name === name && a.categoryId === 4)

  expect(found, `планета ${name} не найдена`).toBeDefined()

  return found!
}
const physical = (name: string) => PhysicalObjects.find((p) => p.actorId === actor(name).id)!
const orbit = (name: string) => Orbits.find((o) => o.actorId === actor(name).id)!
const data = (name: string) => RenderingObjects.find((r) => r.actorId === actor(name).id)!.data as Record<string, unknown>

const PLANETS: readonly string[] = ['Emberon', 'Halcyra', 'Nivalis']
const MOONS: readonly string[] = ['Halcyra I', 'Halcyra II']
const PROCEDURAL: readonly string[] = ['Emberon', 'Halcyra I', 'Halcyra II', 'Nivalis']

describe('W26 — иерархия', () => {
  it('планеты висят под барицентром, спутники — под гигантом', () => {
    const system = Actors.find((a) => a.name === SYSTEM)!

    for (const name of PLANETS) expect(actor(name).parentId).toBe(system.id)
    for (const name of MOONS) expect(actor(name).parentId).toBe(actor('Halcyra').id)
  })

  it('у каждого тела есть физика, орбита и рендер-данные; период выводится из масс', () => {
    for (const name of [...PLANETS, ...MOONS]) {
      expect(physical(name), name).toBeDefined()
      expect(orbit(name), name).toBeDefined()
      expect(data(name), name).toBeDefined()
      expect(orbit(name).period, name).toBe(0)
    }
  })
})

describe('W26 — размещение', () => {
  const starRadiusAu = (): number => PhysicalObjects.find((p) => p.actorId === Actors.find((a) => a.name === 'W26')!.id)!.radius / AU_KM

  it('все планеты дальше точки прилёта к звезде (3 R) и внутри полости кокона', () => {
    const nebula = RenderingObjects.find((r) => r.actorId === Actors.find((a) => a.name === 'W26 Nebula')!.id)!
      .data as { size: number; cavities: Array<{ radius: number }> }
    const cavityAu: number = nebula.size * nebula.cavities[0].radius

    for (const name of PLANETS) {
      const a: number = orbit(name).semiMajorAxis
      const apo: number = a * (1 + orbit(name).eccentricity)
      const peri: number = a * (1 - orbit(name).eccentricity)

      expect(peri, name).toBeGreaterThan(3 * starRadiusAu())
      expect(apo, name).toBeLessThan(cavityAu)
    }
  })

  it('три тела разнесены: соседние орбиты различаются минимум в полтора раза', () => {
    const [a, b, c] = PLANETS.map((name) => orbit(name).semiMajorAxis).sort((x, y) => x - y)

    expect(b / a).toBeGreaterThan(1.5)
    expect(c / b).toBeGreaterThan(1.5)
  })

  it('спутники не задевают гигант и не сталкиваются друг с другом', () => {
    const giantRadiusKm: number = physical('Halcyra').radius
    const [inner, outer] = MOONS.map((name) => orbit(name))

    expect(inner.semiMajorAxis * AU_KM * (1 - inner.eccentricity)).toBeGreaterThan(giantRadiusKm * 2.2)
    expect(outer.semiMajorAxis * (1 - outer.eccentricity)).toBeGreaterThan(inner.semiMajorAxis * (1 + inner.eccentricity) * 1.5)
  })
})

describe('W26 — процедурные поверхности', () => {
  it.each(PROCEDURAL)('%s: ручки поверхности валидны', (name: string) => {
    expect(() => validateProceduralSurface(data(name).proceduralSurface, name)).not.toThrow()
  })

  it('сиды и палитры у всех тел свои', () => {
    const surfaces = PROCEDURAL.map((name) => data(name).proceduralSurface as { seed: number; palette: string[] })

    expect(new Set(surfaces.map((s) => s.seed)).size).toBe(PROCEDURAL.length)
    expect(new Set(surfaces.map((s) => s.palette.join())).size).toBe(PROCEDURAL.length)
  })

  it.each(PROCEDURAL)('%s: привязаны пара height+slope и четыре общие детальные карты', (name: string) => {
    const resourceIds: number[] = ActorResource.filter((r) => r.actorId === actor(name).id).map((r) => r.resourceId)
    const types: string[] = resourceIds.map((id) => Resources.find((r) => r.id === id)!.resourceType)

    expect(types.filter((t) => t === 'height')).toHaveLength(1)
    expect(types.filter((t) => t === 'slope')).toHaveLength(1)
    for (const shared of [126, 127, 128, 129]) expect(resourceIds).toContain(shared)
  })

  it('высоты у каждого тела свои, общего файла нет', () => {
    const heights: number[] = PROCEDURAL.map(
      (name) =>
        ActorResource.filter((r) => r.actorId === actor(name).id)
          .map((r) => Resources.find((x) => x.id === r.resourceId)!)
          .find((r) => r.resourceType === 'height')!.id
    )

    expect(new Set(heights).size).toBe(PROCEDURAL.length)
  })
})
