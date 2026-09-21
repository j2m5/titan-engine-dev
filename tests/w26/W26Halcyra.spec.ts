import { describe, it, expect } from 'vitest'
import { Actors, PhysicalObjects, Orbits, RenderingObjects, Resources, ActorResource } from '@storage/database'
import { EARTH_SOLAR, sunAngularRadius } from '@/core/renderables/Atmosphere/AtmosphereConfig'

const AU_KM: number = 149597870.7

const actorByCat = (name: string, categoryId: number) => {
  const found = Actors.find((a) => a.name === name && a.categoryId === categoryId)

  expect(found, `актор «${name}» категории ${categoryId} не найден`).toBeDefined()

  return found!
}
const planet = (name: string) => actorByCat(name, 4)
const physical = (name: string) => PhysicalObjects.find((p) => p.actorId === planet(name).id)!
const orbit = (name: string) => Orbits.find((o) => o.actorId === planet(name).id)!
const renderData = (actorId: number) => RenderingObjects.find((r) => r.actorId === actorId)!.data as Record<string, unknown>
const resourcePaths = (actorId: number) =>
  ActorResource.filter((r) => r.actorId === actorId).map((r) => Resources.find((res) => res.id === r.resourceId)!)

const starRadiusKm: number = PhysicalObjects.find((p) => p.actorId === Actors.find((a) => a.name === 'W26')!.id)!.radius

describe('Halcyra — гигант, атмосфера, кольцо', () => {
  it('у Halcyra есть дочерние акторы категорий 5 (атмосфера) и 6 (кольцо)', () => {
    const giant = planet('Halcyra')

    const atmosphere = Actors.find((a) => a.parentId === giant.id && a.categoryId === 5)
    const ring = Actors.find((a) => a.parentId === giant.id && a.categoryId === 6)

    expect(atmosphere, 'атмосфера Halcyra').toBeDefined()
    expect(atmosphere!.name).toBe('Halcyra')
    expect(ring, 'кольцо Halcyra').toBeDefined()
    expect(ring!.name).toBe('Halcyra')
  })

  it('рендер-данные гиганта: giantDetail включён, без процедурной поверхности, легаси-сфера', () => {
    const giant = planet('Halcyra')
    const data = renderData(giant.id)

    expect(data.giantDetail).toBe(true)
    expect(data.proceduralSurface).toBeUndefined()

    const resources = resourcePaths(giant.id)
    expect(resources.some((r) => r.path.endsWith('ohann/ohann.png'))).toBe(true)
    expect(resources.some((r) => r.resourceType === 'height')).toBe(false)
    expect(resources.some((r) => r.resourceType === 'slope')).toBe(false)
  })

  it('атмосфера: bottomRadius = радиус планеты, topRadius больше, sunAngularRadius сходится с расчётным', () => {
    const atmosphereActor = actorByCat('Halcyra', 5)
    const data = renderData(atmosphereActor.id) as { bottomRadius: number; topRadius: number; sunAngularRadius: number }

    expect(data.bottomRadius).toBe(physical('Halcyra').radius)
    expect(data.topRadius).toBeGreaterThan(data.bottomRadius)

    const expected = sunAngularRadius(starRadiusKm, orbit('Halcyra').semiMajorAxis)
    expect(Math.abs(data.sunAngularRadius - expected) / expected).toBeLessThan(0.01)
  })

  it('солнечная тройка атмосферы «оранжевая»: r/b минимум втрое ярче земного, каналы не ярче земных', () => {
    const atmosphereActor = actorByCat('Halcyra', 5)
    const data = renderData(atmosphereActor.id) as { solarIrradiance: [number, number, number] }
    const [r, g, b] = data.solarIrradiance
    const earthRatio = EARTH_SOLAR[0] / EARTH_SOLAR[2]

    expect(r / b).toBeGreaterThan(earthRatio * 3)
    expect(r).toBeLessThanOrEqual(EARTH_SOLAR[0])
    expect(g).toBeLessThanOrEqual(EARTH_SOLAR[1])
    expect(b).toBeLessThanOrEqual(EARTH_SOLAR[2])
  })

  it('кольцо: внутренний радиус за пределами оболочки гиганта, внешний — до орбиты Halcyra I; текстура Адрианы', () => {
    const ringActor = actorByCat('Halcyra', 6)
    const data = renderData(ringActor.id) as { innerRadius: number; outerRadius: number }
    const giantRadiusKm = physical('Halcyra').radius
    const moonOrbit = orbit('Halcyra I')
    const periapsisKm = moonOrbit.semiMajorAxis * (1 - moonOrbit.eccentricity) * AU_KM

    expect(data.innerRadius).toBeGreaterThan(1.2 * giantRadiusKm)
    expect(data.outerRadius).toBeLessThan(periapsisKm * 0.6)

    const resources = resourcePaths(ringActor.id)
    expect(resources.some((r) => r.path.endsWith('adriana_rings.png'))).toBe(true)
  })
})
