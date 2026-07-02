import { describe, it, expect } from 'vitest'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { Actor } from '@/core/models/Actor'
import { SolarMass, EarthMass, MoonMass, J2000 } from '@/core/constants'
import { IOrbit } from '@/core/models/types'

/**
 * Минимальный стаб актора: KeplerianModel обращается только к
 * orbit / physicalObject / parent.physicalObject через getAttribute.
 */
function makeActor(orbit: Partial<Omit<IOrbit, 'id' | 'actorId'>>, mass: number, parentMass: number): Actor {
  const attributes = (source: Record<string, number>) => ({
    getAttribute: (key: string, fallback: number = 0): number => source[key] ?? fallback
  })

  return {
    orbit: attributes(orbit as Record<string, number>),
    physicalObject: attributes({ mass }),
    parent: { physicalObject: attributes({ mass: parentMass }) }
  } as unknown as Actor
}

/** Земля на круговой орбите 1 AU — эталон для проверки единиц */
function earthLikeActor(overrides: Partial<Omit<IOrbit, 'id' | 'actorId'>> = {}): Actor {
  return makeActor(
    {
      semiMajorAxis: 1,
      eccentricity: 0,
      inclination: 0,
      argOfPeriapsis: 0,
      ascendingNode: 0,
      meanAnomalyAtEpoch: 0,
      ...overrides
    },
    EarthMass,
    SolarMass
  )
}

describe('KeplerianModel — эпоха элементов', () => {
  it('эпоха читается из данных орбиты, а не из места создания модели', () => {
    const elementsEpoch = 2460676.5 // 2025-01-01 00:00 UTC
    const model = new KeplerianModel(earthLikeActor({ epoch: elementsEpoch, meanAnomalyAtEpoch: 90 }))

    expect(model.epoch).toBe(elementsEpoch)
    // На эпоху элементов средняя аномалия равна meanAnomalyAtEpoch (в радианах)
    expect(model.getMeanAnomalyByEpoch(elementsEpoch)).toBeCloseTo(Math.PI / 2, 12)
  })

  it('без поля epoch в данных подставляется J2000', () => {
    const model = new KeplerianModel(earthLikeActor())

    expect(model.epoch).toBe(J2000)
  })
})

describe('KeplerianModel — data-driven период', () => {
  it('при заданном в орбите периоде meanMotion берётся из него, а не из масс', () => {
    // Луна вокруг EMB: полуось масштабирована к барицентру, массы дают n на 1.85% быстрее.
    // Явный период (сидерический месяц) должен переопределять вывод из mu.
    const moon = makeActor(
      { semiMajorAxis: 380038 / 149597870, eccentricity: 0.0549, period: 27.321661 },
      MoonMass,
      EarthMass
    )
    const model = new KeplerianModel(moon)

    expect(model.period).toBeCloseTo(27.321661, 9)
    expect(model.meanMotion).toBeCloseTo((2 * Math.PI) / 27.321661, 12)
  })

  it('при period=0 действует вывод из гравитационного параметра', () => {
    const model = new KeplerianModel(earthLikeActor({ period: 0 }))

    const periodDays = (2 * Math.PI) / model.meanMotion

    expect(periodDays).toBeGreaterThan(365)
    expect(periodDays).toBeLessThan(366)
  })
})

describe('KeplerianModel — единицы измерения', () => {
  it('mu для системы Солнце-Земля равен GM в AU^3/сутки^2', () => {
    const model = new KeplerianModel(earthLikeActor())

    // Гауссова GM Солнца: k^2 = 2.959e-4 AU^3/сутки^2 (+ ничтожный вклад массы Земли)
    expect(model.mu).toBeCloseTo(2.9591220828559115e-4, 8)
  })

  it('период тела на орбите 1 AU вокруг Солнца — один год в сутках', () => {
    const model = new KeplerianModel(earthLikeActor())

    const periodDays = (2 * Math.PI) / model.meanMotion

    expect(periodDays).toBeGreaterThan(365)
    expect(periodDays).toBeLessThan(366)
  })

  it('геттер period согласован с meanMotion', () => {
    const model = new KeplerianModel(earthLikeActor({ eccentricity: 0.0167 }))

    expect(model.period).toBeCloseTo((2 * Math.PI) / model.meanMotion, 6)
  })

  it('через год тело возвращается в исходную точку орбиты', () => {
    const model = new KeplerianModel(earthLikeActor({ eccentricity: 0.0167, meanAnomalyAtEpoch: 40 }))

    const start = model.getStateByEpoch(J2000).position
    const afterYear = model.getStateByEpoch(J2000 + model.period).position

    expect(afterYear.distanceTo(start)).toBeLessThan(1e-6)
  })

  it('радиус позиции на круговой орбите равен большой полуоси в AU', () => {
    const model = new KeplerianModel(earthLikeActor())

    const { position } = model.getStateByEpoch(J2000 + 123.456)

    expect(position.length()).toBeCloseTo(1, 9)
  })

  it('период Луны вокруг Земли — сидерический месяц', () => {
    // Большая полуось лунной орбиты: 384 400 км в AU
    const moon = makeActor(
      { semiMajorAxis: 384400 / 149597870, eccentricity: 0.0549, meanAnomalyAtEpoch: 0 },
      MoonMass,
      EarthMass
    )
    const model = new KeplerianModel(moon)

    expect(model.period).toBeGreaterThan(27.2)
    expect(model.period).toBeLessThan(27.5)
  })

  it('за четверть периода тело проходит четверть круговой орбиты', () => {
    const model = new KeplerianModel(earthLikeActor())

    const start = model.getStateByEpoch(J2000).position
    const quarter = model.getStateByEpoch(J2000 + model.period / 4).position

    // На круговой орбите радиус-векторы через четверть периода ортогональны
    expect(start.dot(quarter)).toBeCloseTo(0, 6)
  })
})
