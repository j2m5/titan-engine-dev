import { Actor } from '@/core/models/Actor'
import { describeBody } from '@/core/bodyInfo/describeBody'

const describeId = (id: number) => describeBody(Actor.find(id)!)

describe('describeBody: справка из тех же моделей, что движут сцену', () => {
  it('Земля: шапка, гравитация, вторая космическая, плотность, M⊕ и R⊕', () => {
    const earth = describeId(7)

    expect(earth.name).toBe('Earth')
    expect(earth.typeLabel).toBe('Planet')
    expect(earth.primaryName).toBe('Sun')
    expect(earth.physics!.gravityMs2).toBeCloseTo(9.86, 1)
    expect(earth.physics!.escapeKms).toBeCloseTo(11.2, 1)
    expect(earth.physics!.densityGcm3).toBeCloseTo(5.54, 1)
    expect(earth.physics!.relativeMass).toEqual({ value: expect.closeTo(1, 2), unit: 'M⊕' })
    expect(earth.physics!.relativeRadius!.unit).toBe('R⊕')
  })

  it('нулевая температура в данных скрыта; светимость — только у звёзд', () => {
    const jupiter = describeId(10)

    expect(jupiter.physics!.temperatureK).toBeNull()
    expect(jupiter.physics!.luminositySun).toBeNull()
  })

  it('Солнце: светимость ≈ 1 L☉, массы и радиусы в солнечных', () => {
    const sun = describeId(4)

    expect(sun.physics!.luminositySun).toBeCloseTo(1, 1)
    expect(sun.physics!.relativeMass!.unit).toBe('M☉')
    expect(sun.physics!.relativeRadius!.unit).toBe('R☉')
    expect(sun.primaryName).toBeNull()
  })

  it('Sgr A*: радиус Шварцшильда сходится с радиусом из данных, гравитации и плотности нет', () => {
    const sgr = describeId(43)

    expect(sgr.physics!.schwarzschildKm! / sgr.physics!.radiusKm).toBeCloseTo(1, 3)
    expect(sgr.physics!.gravityMs2).toBeNull()
    expect(sgr.physics!.densityGcm3).toBeNull()
    expect(sgr.physics!.escapeKms).toBeNull()
    expect(sgr.physics!.relativeRadius).toBeNull()
  })

  it('Луна: период вращения из строки вращения (655.7 ч), а не из физобъекта (15542 ч)', () => {
    expect(describeId(19).rotation!.periodHours).toBeCloseTo(655.72, 1)
  })

  it('орбита Марса — из KeplerianModel', () => {
    const orbit = describeId(8).orbit!

    expect(orbit.semiMajorAxisAu).toBeCloseTo(1.5236, 3)
    expect(orbit.eccentricity).toBeCloseTo(0.0934, 3)
    expect(orbit.periodDays).toBeCloseTo(686.98, 1)
  })

  it('у тела без орбиты блока орбиты нет (Sgr A* в барицентре)', () => {
    expect(describeId(43).orbit).toBeNull()
  })
})
