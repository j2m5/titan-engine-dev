import { describe, it, expect } from 'vitest'
import { Actors, PhysicalObjects, RenderingObjects, RotationObjects, Orbits } from '@storage/database'
import { Scenarios } from '@/config/scenarios'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { nebulaParamsFromData, type NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { IGiantStarRenderingObject } from '@/core/models/types'

const AU_KM: number = 149597870.7
const SOLAR_RADIUS_KM: number = 695700

function actorByName(name: string) {
  const actor = Actors.find((a) => a.name === name)

  expect(actor, `актор ${name} не найден`).toBeDefined()

  return actor!
}

describe('система W26 — состав', () => {
  it('барицентр, звезда-гигант и туманность', () => {
    const system = actorByName('Westerlund 1-26 system')
    const star = actorByName('W26')
    const nebula = actorByName('W26 Nebula')

    expect(system.categoryId).toBe(1)
    expect(system.parentId).toBeNull()
    expect(star.categoryId).toBe(10)
    expect(star.parentId).toBe(system.id)
    expect(nebula.categoryId).toBe(7)
    expect(nebula.parentId).toBe(system.id)
  })

  it('звезда — центральное тело: физика и вращение есть, орбиты нет', () => {
    const star = actorByName('W26')

    expect(PhysicalObjects.find((p) => p.actorId === star.id)).toBeDefined()
    expect(RotationObjects.find((r) => r.actorId === star.id)).toBeDefined()
    expect(Orbits.find((o) => o.actorId === star.id)).toBeUndefined()
  })
})

describe('система W26 — звезда', () => {
  it('красный сверхгигант: полторы тысячи солнечных радиусов, 3700 K', () => {
    const physical = PhysicalObjects.find((p) => p.actorId === actorByName('W26').id)!

    expect(physical.radius / SOLAR_RADIUS_KM).toBeGreaterThan(1400)
    expect(physical.radius / SOLAR_RADIUS_KM).toBeLessThan(1600)
    expect(physical.temperature).toBe(3700)
  })

  it('данные облика — сверхгигантские: ячеек единицы', () => {
    const data = RenderingObjects.find((r) => r.actorId === actorByName('W26').id)!.data as IGiantStarRenderingObject

    expect(data.cellCount).toBeGreaterThanOrEqual(4)
    expect(data.cellCount).toBeLessThanOrEqual(6)
    expect(data.atmosphereDensity).toBeGreaterThan(0)
  })
})

describe('система W26 — кокон', () => {
  const radiusAu = (): number => PhysicalObjects.find((p) => p.actorId === actorByName('W26').id)!.radius / AU_KM
  const data = (): NebulaRenderingData =>
    RenderingObjects.find((r) => r.actorId === actorByName('W26 Nebula').id)!.data as NebulaRenderingData

  it('звезда сидит в центральной полости', () => {
    const cavity = nebulaParamsFromData(data()).cavities[0]

    expect(cavity.center.toArray()).toEqual([0, 0, 0])
    expect(cavity.strength).toBeGreaterThan(0.8)
  })

  it('полость шире оболочки звезды и точки прилёта с запасом', () => {
    // Орбиты следующей арки ложатся между точкой прилёта (3 R) и стенкой
    const cavityAu: number = data().size! * data().cavities![0].radius!

    expect(cavityAu).toBeGreaterThan(radiusAu() * 15)
    expect(cavityAu).toBeLessThan(data().size!)
  })

  it('свет идёт от звезды, в её цвете и со спадом у стенки полости', () => {
    const lighting = nebulaParamsFromData(data()).lighting

    expect(lighting.starPosition!.toArray()).toEqual([0, 0, 0])
    expect(lighting.color!.r).toBeGreaterThan(lighting.color!.b * 3)
    expect(lighting.falloffRadius).toBeCloseTo(data().cavities![0].radius!, 1)
  })

  it('радиальный тон: тёплое сердце, бирюзовая оболочка', () => {
    const palette = nebulaParamsFromData(data()).palette

    expect(palette.radialMix).toBeGreaterThan(0)
    expect(palette.innerColor.r).toBeGreaterThan(palette.innerColor.b)
    expect(palette.outerColor.g).toBeGreaterThan(palette.outerColor.r)
  })

  it('асимметрия: лобы есть, среди них вынесенный за тело облака выброс', () => {
    const lobes = nebulaParamsFromData(data()).lobes

    expect(lobes.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...lobes.map((lobe) => lobe.center.length()))).toBeGreaterThan(0.7)
  })
})

describe('система W26 — сценарий', () => {
  it('система достижима из списка сцен: сценарий указывает на её барицентр', () => {
    const system = actorByName('Westerlund 1-26 system')
    const scenario = Scenarios.find((s) => s.rootId === system.id)

    expect(scenario).toBeDefined()
  })

  it('источник света сцены — сама звезда', () => {
    const system = actorByName('Westerlund 1-26 system')
    const star = actorByName('W26')
    const scenario = Scenarios.find((s) => s.rootId === system.id)!

    expect(scenario.lightSources).toEqual([star.id])
  })

  it('стартовая камера видит кокон целиком, а не сидит внутри него', () => {
    const system = actorByName('Westerlund 1-26 system')
    const scenario = Scenarios.find((s) => s.rootId === system.id)!
    const nebula = RenderingObjects.find((r) => r.actorId === actorByName('W26 Nebula').id)!
      .data as NebulaRenderingData

    const [x, y, z] = scenario.defaultCameraPosition
    const cameraDistance = Math.hypot(x, y, z)

    expect(cameraDistance).toBeGreaterThan(fromAstronomicalUnits(nebula.size!))
  })

  it('id сценария уникален', () => {
    const system = actorByName('Westerlund 1-26 system')
    const scenario = Scenarios.find((s) => s.rootId === system.id)!

    expect(Scenarios.filter((s) => s.id === scenario.id)).toHaveLength(1)
  })
})
