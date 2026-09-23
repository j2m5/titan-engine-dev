import { describe, it, expect } from 'vitest'
import { Actors, Orbits, RenderingObjects } from '@storage/database'
import { asteroidBeltParameters } from '@/core/renderables/AsteroidBelt/AsteroidBeltParameters'
import type { NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import type { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'

const MIN_GAP_AU = 5

function actorByName(name: string) {
  const actor = Actors.find((a) => a.name === name)

  expect(actor, `актор ${name} не найден`).toBeDefined()

  return actor!
}

/** Голый актор для asteroidBeltParameters — своя копия helper'а из AsteroidBeltParameters.spec.ts */
function fakeActor(data: IAsteroidBeltRenderingObject): Actor {
  return { renderingObject: { getAttribute: (): unknown => data }, getAttribute: () => 'Ashfall Belt' } as unknown as Actor
}

function beltData(): IAsteroidBeltRenderingObject {
  const belt = actorByName('Ashfall Belt')
  const row = RenderingObjects.find((r) => r.actorId === belt.id)

  expect(row, 'у пояса нет renderingObject').toBeDefined()

  return row!.data as unknown as IAsteroidBeltRenderingObject
}

describe('пояс Ashfall Belt — система W26', () => {
  it('единственный актор категории 11 в базе, под барицентром системы', () => {
    const belts = Actors.filter((a) => a.categoryId === 11)

    expect(belts).toHaveLength(1)
    expect(belts[0].parentId).toBe(actorByName('Westerlund 1-26 system').id)
    expect(belts[0].name).toBe('Ashfall Belt')
  })

  it('рендер-данные валидны через asteroidBeltParameters', () => {
    const params = asteroidBeltParameters(fakeActor(beltData()))

    expect(params.innerRadiusKm).toBeGreaterThan(0)
    expect(params.outerRadiusKm).toBeGreaterThan(params.innerRadiusKm)
    expect(params.spacingKm).toBeGreaterThan(0)
  })

  it('радиусы между орбитами Emberon и Halcyra, зазор ≥ 5 а.е. до каждой', () => {
    const data = beltData()
    const emberonOrbit = Orbits.find((o) => o.actorId === actorByName('Emberon').id)!
    const halcyraOrbit = Orbits.find((o) => o.actorId === actorByName('Halcyra').id)!

    expect(data.innerRadiusAu).toBeGreaterThan(emberonOrbit.semiMajorAxis)
    expect(data.outerRadiusAu).toBeLessThan(halcyraOrbit.semiMajorAxis)
    expect(data.innerRadiusAu - emberonOrbit.semiMajorAxis).toBeGreaterThanOrEqual(MIN_GAP_AU)
    expect(halcyraOrbit.semiMajorAxis - data.outerRadiusAu).toBeGreaterThanOrEqual(MIN_GAP_AU)
  })

  it('пояс целиком внутри полости кокона', () => {
    const nebula = RenderingObjects.find((r) => r.actorId === actorByName('W26 Nebula').id)!
      .data as NebulaRenderingData
    const cavityAu = nebula.size! * nebula.cavities![0].radius!

    expect(beltData().outerRadiusAu).toBeLessThan(cavityAu)
  })
})
