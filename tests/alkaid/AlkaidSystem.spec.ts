import { describe, it, expect } from 'vitest'
import { ActorResource, Actors, Orbits, PhysicalObjects, RenderingObjects, Resources, RotationObjects } from '@storage/database'
import { Scenarios } from '@/config/scenarios'
import { colorTemperatureToRGB } from '@/core/materials/shaders/lib/helpers'
import { EARTH_SOLAR, sunAngularRadius } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { asteroidBeltParameters } from '@/core/renderables/AsteroidBelt/AsteroidBeltParameters'
import type { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'

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

/** Линейное значение sRGB-канала 0..255 */
const linear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
/** Тройка облучения атмосферы по правилу W26: земная тройка × линейный цвет звезды */
const expectedIrradiance = () => {
  const c = colorTemperatureToRGB(physicalOf(actorByName('Alkaid').id).temperature)
  return [EARTH_SOLAR[0] * linear(c.r), EARTH_SOLAR[1] * linear(c.g), EARTH_SOLAR[2] * linear(c.b)]
}
const atmosphereData = (actorId: number) =>
  renderingOf(actorId).data as {
    solarIrradiance: number[]
    sunAngularRadius: number
    bottomRadius: number
    topRadius: number
    muSMin: number
  }
const resourcesOf = (actorId: number) =>
  ActorResource.filter((r) => r.actorId === actorId).map((r) => Resources.find((x) => x.id === r.resourceId)!)

describe('сцена Алькаид: гигант Thalorn с атмосферой и кольцом', () => {
  it('планета под барицентром, физика под звездой, орбита 18 а.е. с периодом 0 (движок считает сам)', () => {
    const thalorn = actorByName('Thalorn')

    expect(thalorn.categoryId).toBe(4)
    expect(thalorn.parentId).toBe(actorByName('Alkaid system').id)
    expect(physicalOf(thalorn.id).parentId).toBe(physicalOf(actorByName('Alkaid').id).id)
    expect(physicalOf(thalorn.id).radius).toBe(60000)
    expect(orbitOf(thalorn.id).semiMajorAxis).toBe(18)
    expect(orbitOf(thalorn.id).period).toBe(0)
  })

  it('диффуз — Adriana (экзопланета), giantDetail включён', () => {
    const thalorn = actorByName('Thalorn')

    expect(resourcesOf(thalorn.id).map((r) => r.path)).toEqual(['planets/StarWars/adriana/adriana.png'])
    expect((renderingOf(thalorn.id).data as { giantDetail?: boolean }).giantDetail).toBe(true)
  })

  it('атмосфера: дочерний актор категории 5, дно = радиус планеты, облучение и угловой радиус по формулам', () => {
    const thalorn = actorByName('Thalorn')
    const atm = Actors.find((a) => a.categoryId === 5 && a.parentId === thalorn.id)
    expect(atm).toBeDefined()
    const data = atmosphereData(atm!.id)
    const star = physicalOf(actorByName('Alkaid').id)

    expect(data.bottomRadius).toBe(physicalOf(thalorn.id).radius)
    expect(data.topRadius).toBeGreaterThan(data.bottomRadius)
    expectedIrradiance().forEach((v, i) => expect(data.solarIrradiance[i]).toBeCloseTo(v, 3))
    expect(data.sunAngularRadius).toBeCloseTo(sunAngularRadius(star.radius, orbitOf(thalorn.id).semiMajorAxis), 6)
  })

  it('кольцо: дочерний актор категории 6 на текстуре колец Darkness, радиусы 1.25–2.1 R планеты, наклон — строкой вращения планеты', () => {
    const thalorn = actorByName('Thalorn')
    const ring = Actors.find((a) => a.categoryId === 6 && a.parentId === thalorn.id)
    expect(ring).toBeDefined()
    const data = renderingOf(ring!.id).data as { innerRadius: number; outerRadius: number; profile: string }
    const R = physicalOf(thalorn.id).radius

    expect(resourcesOf(ring!.id).map((r) => r.path)).toEqual(['planets/StarWars/darkness/darkness_rings.png'])
    expect(data.innerRadius).toBeGreaterThanOrEqual(1.25 * R)
    expect(data.outerRadius).toBeLessThanOrEqual(2.1 * R)
    expect(data.innerRadius).toBeLessThan(data.outerRadius)
    expect(data.profile).toBe('icy')
    expect(RotationObjects.find((r) => r.actorId === thalorn.id)).toBeDefined()
  })
})

describe('сцена Алькаид: ледяная планета Isvara', () => {
  it('планета 3800 км на 48 а.е., физика под звездой', () => {
    const isvara = actorByName('Isvara')

    expect(isvara.categoryId).toBe(4)
    expect(isvara.parentId).toBe(actorByName('Alkaid system').id)
    expect(physicalOf(isvara.id).radius).toBe(3800)
    expect(physicalOf(isvara.id).parentId).toBe(physicalOf(actorByName('Alkaid').id).id)
    expect(orbitOf(isvara.id).semiMajorAxis).toBe(48)
  })

  it('ресурсы: одна карта высот (resident) и одна склонов по конвенции, ледяной детальный набор', () => {
    const paths = resourcesOf(actorByName('Isvara').id)
    const height = paths.filter((r) => r.resourceType === 'height')
    const slope = paths.filter((r) => r.resourceType === 'slope')

    expect(height).toHaveLength(1)
    expect(height[0].path).toBe('planets/unnamed/alkaid/isvara_height.raw')
    expect(height[0].lifecycle).toBe('resident')
    expect(slope).toHaveLength(1)
    expect(slope[0].path).toBe('planets/unnamed/alkaid/isvara_slope.webp')
    expect(paths.find((r) => r.resourceType === 'detailDiffuse')!.path).toBe('terrain/ice_diff.webp')
    expect(paths.some((r) => r.resourceType === 'detailNormal2')).toBe(true)
  })

  it('процедурная поверхность с холодной палитрой, cavityStrength > 0', () => {
    const data = renderingOf(actorByName('Isvara').id).data as {
      proceduralSurface: { palette: string[]; seed: number }
      cavityStrength: number
    }

    expect(data.proceduralSurface.palette).toHaveLength(4)
    expect(data.proceduralSurface.palette[0]).toBe('#0b1a22')
    expect(data.cavityStrength).toBeGreaterThan(0)
  })

  it('атмосфера: дно = радиус, облучение и угловой радиус по формулам, muSMin не мельче погружения горизонта', () => {
    const isvara = actorByName('Isvara')
    const atm = Actors.find((a) => a.categoryId === 5 && a.parentId === isvara.id)
    expect(atm).toBeDefined()
    const data = atmosphereData(atm!.id)
    const star = physicalOf(actorByName('Alkaid').id)
    const dip = Math.asin(Math.sqrt(1 - (data.bottomRadius / data.topRadius) ** 2))

    expect(data.bottomRadius).toBe(3800)
    expectedIrradiance().forEach((v, i) => expect(data.solarIrradiance[i]).toBeCloseTo(v, 3))
    expect(data.sunAngularRadius).toBeCloseTo(sunAngularRadius(star.radius, orbitOf(isvara.id).semiMajorAxis), 6)
    expect(data.muSMin).toBeLessThanOrEqual(-Math.sin(1.6 * dip + (5 * Math.PI) / 180) + 1e-3)
  })
})

const beltActorStub = (data: IAsteroidBeltRenderingObject): Actor =>
  ({
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'categoryId' ? 11 : f)
  }) as unknown as Actor

describe('сцена Алькаид: пояс Frostwake Belt', () => {
  const beltData = () => renderingOf(actorByName('Frostwake Belt').id).data as unknown as IAsteroidBeltRenderingObject

  it('единственный пояс системы, под барицентром, со строкой вращения (наклон к плоскости системы)', () => {
    const system = actorByName('Alkaid system')
    const belts = Actors.filter((a) => a.categoryId === 11 && a.parentId === system.id)

    expect(belts).toHaveLength(1)
    expect(belts[0].name).toBe('Frostwake Belt')
    expect(RotationObjects.find((r) => r.actorId === belts[0].id)?.period).toBe(0)
  })

  it('лента 25–34 а.е. лежит между орбитами гиганта и ледяной планеты — ни одна орбита её не пересекает', () => {
    const { innerRadiusAu, outerRadiusAu } = beltData()
    const thalorn = orbitOf(actorByName('Thalorn').id)
    const isvara = orbitOf(actorByName('Isvara').id)

    expect(thalorn.semiMajorAxis * (1 + thalorn.eccentricity)).toBeLessThan(innerRadiusAu)
    expect(isvara.semiMajorAxis * (1 - isvara.eccentricity)).toBeGreaterThan(outerRadiusAu)
  })

  it('данные проходят через asteroidBeltParameters: тёмная порода с ледяной примесью, холодная пыль', () => {
    const p = asteroidBeltParameters(beltActorStub(beltData()))

    expect(p.profile).toBe('carbonaceous')
    expect(p.iceFraction).toBeGreaterThan(0.3)
    expect(p.iceProfile).toBe('icy')
    expect(p.dustEnabled).toBe(true)
    expect(p.dustExtinction).toBe(1)
    expect(beltData().structure?.arcs?.length).toBeGreaterThan(0)
  })
})

export { actorByName, physicalOf, orbitOf, renderingOf, atmosphereData, expectedIrradiance, resourcesOf }
