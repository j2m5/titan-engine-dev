import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { database } from '@/config/database'
import { EarthMass, G, J2000, SolarMass } from '@/core/constants'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { Actor } from '@/core/models/Actor'

describe('KeplerianModel — чтение живых данных при расчёте', () => {
  const tables = ['actors', 'orbits', 'physicalObjects']
  let saved: Map<string, unknown>

  beforeEach(() => {
    saved = new Map(tables.map((table) => [table, database.get(table)]))
    database.set('actors', [{ id: 1, name: 'Parent' }])
    database.set('orbits', [{ id: 11, actorId: 2, semiMajorAxis: 1, eccentricity: 0 }])
    database.set('physicalObjects', [
      { id: 21, actorId: 1, mass: SolarMass },
      { id: 22, actorId: 2, mass: EarthMass }
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const [table, rows] of saved) database.set(table, rows)
  })

  it.each([0, 0.95, 1.5])('решатель при e=%s не повторяет запрос орбиты на каждой итерации', (eccentricity) => {
    database.set('orbits', [{ id: 11, actorId: 2, semiMajorAxis: 1, eccentricity }])
    const actor = new Actor({ id: 2, parentId: 1 })
    const model = new KeplerianModel(actor)
    const reads = vi.spyOn(actor, 'orbit', 'get')

    for (const meanAnomaly of [0.01, 1.6, -10]) {
      reads.mockClear()
      const eccentricAnomaly = model.getEccentricAnomalyByMeanAnomaly(meanAnomaly)
      const normalizedMean = ((meanAnomaly % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      const residual = eccentricity < 1
        ? eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - normalizedMean
        : eccentricity * Math.sinh(eccentricAnomaly) - eccentricAnomaly - meanAnomaly

      expect(Math.abs(residual)).toBeLessThanOrEqual(1e-8)
      expect(reads).toHaveBeenCalledTimes(1)
    }
  })

  it('расчёт mu получает каждую связанную модель один раз', () => {
    const actor = new Actor({ id: 2, parentId: 1 })
    const parentReads = vi.spyOn(actor, 'parent', 'get')
    const physicalReads = vi.spyOn(Actor.prototype, 'physicalObject', 'get')

    expect(new KeplerianModel(actor).mu).toBeCloseTo(2.9591220828559115e-4, 8)
    expect(parentReads).toHaveBeenCalledTimes(1)
    expect(physicalReads).toHaveBeenCalledTimes(2)
  })

  it('изменения орбиты на той же эпохе видны уже в следующем расчёте', () => {
    const model = new KeplerianModel(new Actor({ id: 2, parentId: 1 }))
    const first = model.getStateByEpoch(J2000)
    expect(first.position.toArray()).toEqual([1, 0, 0])

    database.set('orbits', [{ id: 12, actorId: 2, semiMajorAxis: 4, eccentricity: 0.5 }])
    const changed = model.getStateByEpoch(J2000)
    expect(changed.position.toArray()).toEqual([2, 0, 0])
    expect(changed.velocity.length() / first.velocity.length()).toBeCloseTo(Math.sqrt(0.75), 12)
    // Результаты отдельных вызовов также не разделяют изменяемые векторы.
    expect(first.position.toArray()).toEqual([1, 0, 0])
  })

  it.each([
    { semiMajorAxis: 2, eccentricity: 0.5, speedSquaredPerMu: 1.5 },
    { semiMajorAxis: -2, eccentricity: 1.5, speedSquaredPerMu: 2.5 }
  ])('позиция и скорость при e=$eccentricity повёрнуты в одну орбитальную рамку', (orbit) => {
    database.set('orbits', [{ id: 11, actorId: 2, ...orbit, ascendingNode: 90 }])
    const { position, velocity } = new KeplerianModel(new Actor({ id: 2, parentId: 1 })).getStateByEpoch(J2000)

    // Перицентр r=1 AU направлен вдоль -Z, скорость — вдоль -X.
    expect(position.x).toBeCloseTo(0, 12)
    expect(position.y).toBeCloseTo(0, 12)
    expect(position.z).toBeCloseTo(-1, 12)
    expect(velocity.x).toBeLessThan(0)
    expect(velocity.y).toBeCloseTo(0, 12)
    expect(velocity.z).toBeCloseTo(0, 12)
    // Из vis-viva v²/GM = 2/r - 1/a, независимо от решателя аномалии.
    const gravitationalParameter = (G * (SolarMass + EarthMass)) / SolarMass
    expect(velocity.lengthSq() / gravitationalParameter).toBeCloseTo(orbit.speedSquaredPerMu, 12)
  })

  it('замена масс и родителя не оставляет устаревший гравитационный параметр', () => {
    const actor = new Actor({ id: 2, parentId: 1 })
    const model = new KeplerianModel(actor)
    const first = model.mu

    database.set('physicalObjects', [
      { id: 21, actorId: 1, mass: SolarMass * 4 },
      { id: 22, actorId: 2, mass: EarthMass * 4 },
      { id: 23, actorId: 3, mass: SolarMass * 2 }
    ])
    expect(model.mu).toBe(first * 4)
    database.set('actors', [{ id: 3, name: 'New parent' }])
    actor.setAttribute('parentId', 3)
    expect(model.mu).toBeGreaterThan(first * 2)
    expect(model.mu).toBeLessThan(first * 2.001)
  })

  it('явный период и его изменение управляют положением независимо от масс', () => {
    const model = new KeplerianModel(new Actor({ id: 2, parentId: 1 }))
    for (const [period, x, z] of [[8, 0, -1], [4, -1, 0]]) {
      database.set('orbits', [{ id: 11, actorId: 2, semiMajorAxis: 1, eccentricity: 0, period }])
      const { position } = model.getStateByEpoch(J2000 + 2)
      expect(position.x).toBeCloseTo(x, 12)
      expect(position.y).toBeCloseTo(0, 12)
      expect(position.z).toBeCloseTo(z, 12)
    }
  })

  it('отсутствующая орбита даёт нулевое состояние без чтения масс', () => {
    database.set('orbits', [])
    database.set('physicalObjects', [{ id: 21, actorId: 1 }, { id: 22, actorId: 2 }])
    const state = new KeplerianModel(new Actor({ id: 2, parentId: 1 })).getStateByEpoch(J2000)
    expect(state.position.toArray()).toEqual([0, 0, 0])
    expect(state.velocity.toArray()).toEqual([0, 0, 0])
  })

  it.each([1, 2])('отсутствующая масса у актора %s остаётся ошибкой данных', (actorId) => {
    database.set('physicalObjects', [
      { id: 21, actorId: 1, mass: actorId === 1 ? undefined : SolarMass },
      { id: 22, actorId: 2, mass: actorId === 2 ? undefined : EarthMass }
    ])
    expect(() => new KeplerianModel(new Actor({ id: 2, parentId: 1 })).mu).toThrow('отсутствует масса')
  })

  it('отсутствующая физическая модель сохраняет нулевой mu', () => {
    database.set('physicalObjects', [])
    expect(new KeplerianModel(new Actor({ id: 2, parentId: 1 })).mu).toBe(0)
    expect(new KeplerianModel(new Actor({ id: 2 })).mu).toBe(0)
  })
})
