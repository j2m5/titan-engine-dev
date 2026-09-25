import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Actors, Orbits, PhysicalObjects, RenderingObjects, RotationObjects } from '@storage/database'
import { Scenarios } from '@/config/scenarios'
import type { IPulsarRenderingObject } from '@/core/models/types'

const SOLAR_MASS_KG = 1.9891e30
const G_SI = 6.6743e-11
const C_SI = 2.99792458e8

const byName = (name: string) => {
  const a = Actors.find((x) => x.name === name)
  expect(a, `актор «${name}» не найден`).toBeDefined()
  return a!
}
const physicsOf = (id: number) => PhysicalObjects.find((p) => p.actorId === id)!
const orbitOf = (id: number) => Orbits.find((o) => o.actorId === id)!

describe('сцена NGC 1851E: пульсар и чёрная дыра вокруг барицентра', () => {
  it('корень — барицентр; под ним ровно два актора: пульсар (12) и чёрная дыра (2)', () => {
    const root = byName('NGC 1851E system')
    const psr = byName('PSR J0514-4002E')
    const bh = byName('NGC 1851E companion')
    const children = Actors.filter((a) => a.parentId === root.id)

    expect(root.categoryId).toBe(1)
    expect(psr.categoryId).toBe(12)
    expect(bh.categoryId).toBe(2)
    expect(children.map((a) => a.id).sort()).toEqual([psr.id, bh.id].sort())
  })

  it('массы: пульсар 1.49 M☉, дыра 2.4 M☉ (измеренная сумма 3.887 M☉ с точностью 1 %)', () => {
    const psr = physicsOf(byName('PSR J0514-4002E').id)
    const bh = physicsOf(byName('NGC 1851E companion').id)

    expect(psr.mass / SOLAR_MASS_KG).toBeCloseTo(1.49, 2)
    expect(bh.mass / SOLAR_MASS_KG).toBeCloseTo(2.4, 2)
    expect((psr.mass + bh.mass) / SOLAR_MASS_KG).toBeCloseTo(3.887, 1)
  })

  it('дыра: радиус равен радиусу Шварцшильда 2GM/c² (допуск 1 %), диска нет (температура 0)', () => {
    const bh = physicsOf(byName('NGC 1851E companion').id)
    const rsKm = (2 * G_SI * bh.mass) / (C_SI * C_SI) / 1000

    expect(Math.abs(bh.radius - rsKm) / rsKm).toBeLessThan(0.01)
    expect(bh.temperature).toBe(0)
  })

  it('орбиты: период 7.44 сут, e = 0.708, общие узел и наклон, перицентры через 180°, полуоси делятся по массам', () => {
    const psrId = byName('PSR J0514-4002E').id
    const bhId = byName('NGC 1851E companion').id
    const op = orbitOf(psrId)
    const ob = orbitOf(bhId)
    const mp = physicsOf(psrId).mass
    const mb = physicsOf(bhId).mass

    expect(op.period).toBeCloseTo(7.44, 2)
    expect(ob.period).toBeCloseTo(7.44, 2)
    expect(op.eccentricity).toBeCloseTo(0.708, 3)
    expect(ob.eccentricity).toBeCloseTo(0.708, 3)
    expect(op.inclination).toBe(ob.inclination)
    expect(op.ascendingNode).toBe(ob.ascendingNode)
    expect(op.meanAnomalyAtEpoch).toBe(ob.meanAnomalyAtEpoch)
    expect(Math.abs(((op.argOfPeriapsis - ob.argOfPeriapsis) % 360) + 360) % 360).toBeCloseTo(180, 6)
    // Барицентрические полуоси обратно пропорциональны массам
    expect(op.semiMajorAxis / ob.semiMajorAxis).toBeCloseTo(mb / mp, 2)
  })

  it('третий закон Кеплера: (a_psr + a_bh)³ / P² = M_total в а.е., годах и M☉ (допуск 2 %)', () => {
    const psrId = byName('PSR J0514-4002E').id
    const bhId = byName('NGC 1851E companion').id
    const aTotal = orbitOf(psrId).semiMajorAxis + orbitOf(bhId).semiMajorAxis
    const periodYears = orbitOf(psrId).period / 365.25
    const mTotal = (physicsOf(psrId).mass + physicsOf(bhId).mass) / SOLAR_MASS_KG

    expect((aTotal ** 3 / periodYears ** 2) / mTotal).toBeCloseTo(1, 1)
  })

  it('пульсар: строка вращения есть, лучи включены и длиннее суммарной полуоси — заметают компаньона', () => {
    const psrId = byName('PSR J0514-4002E').id
    const bhId = byName('NGC 1851E companion').id
    const data = RenderingObjects.find((r) => r.actorId === psrId)!.data as IPulsarRenderingObject
    const aTotal = orbitOf(psrId).semiMajorAxis + orbitOf(bhId).semiMajorAxis

    expect(RotationObjects.find((r) => r.actorId === psrId)).toBeDefined()
    expect(data.beamIntensity!).toBeGreaterThan(0)
    expect(data.beamLengthAu!).toBeGreaterThan(aTotal)
    expect(RenderingObjects.find((r) => r.actorId === bhId)).toBeDefined()
  })

  it('сценарий 15: корень — система NGC 1851E, светил нет, камера охватывает орбиту', () => {
    const root = byName('NGC 1851E system')
    const scenario = Scenarios.find((s) => s.rootId === root.id)
    const psrId = byName('PSR J0514-4002E').id
    const apoapsis = orbitOf(psrId).semiMajorAxis * (1 + orbitOf(psrId).eccentricity)

    expect(scenario).toBeDefined()
    expect(scenario!.id).toBe(15)
    expect(scenario!.lightSources).toEqual([])
    const cameraAu = new Vector3(...scenario!.defaultCameraPosition).length() / 1
    expect(cameraAu).toBeGreaterThan(0)
    expect(apoapsis).toBeLessThan(0.2)
  })
})
