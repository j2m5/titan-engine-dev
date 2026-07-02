import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { Actor } from '@/core/models/Actor'
import { J2000 } from '@/core/constants'
import { IRotationObject } from '@/core/models/types'

type RotationAttrs = Partial<Omit<IRotationObject, 'id' | 'actorId'>>

/**
 * Стаб актора: OrientationModel обращается только к rotation / physicalObject
 * через getAttribute. rotation = null моделирует отсутствие строки в таблице.
 */
function makeActor(rotation: RotationAttrs | null, physical: Record<string, number> = {}): Actor {
  const attributes = (source: Record<string, number>) => ({
    getAttribute: (key: string, fallback: number = 0): number => source[key] ?? fallback
  })

  return {
    rotation: rotation === null ? null : attributes(rotation as Record<string, number>),
    physicalObject: attributes(physical)
  } as unknown as Actor
}

/** Полюс тела в мировых координатах Three.js (Y-up) на заданную эпоху */
function poleAt(model: OrientationModel, epoch: number): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(model.getQuaternion(epoch)).normalize()
}

const EARTH_SIDEREAL_HOURS = 23.93447117

describe('OrientationModel — направление полюса', () => {
  it('полюс Земли наклонён на 23.44° от нормали эклиптики в сторону -Z', () => {
    // Земля в эклиптической параметризации: узел 180°, наклон 23.4393°
    const earth = makeActor({ ascendingNode: 180, inclination: 23.4393, meridianAngle: 0, period: EARTH_SIDEREAL_HOURS })
    const model = new OrientationModel(earth)

    const pole = poleAt(model, J2000)
    const eps = (23.4393 * Math.PI) / 180

    expect(pole.x).toBeCloseTo(0, 10)
    expect(pole.y).toBeCloseTo(Math.cos(eps), 10)
    expect(pole.z).toBeCloseTo(-Math.sin(eps), 10)
  })

  it('полюс неподвижен во времени (прецессию не моделируем)', () => {
    const earth = makeActor({ ascendingNode: 180, inclination: 23.4393, meridianAngle: 10, period: EARTH_SIDEREAL_HOURS })
    const model = new OrientationModel(earth)

    expect(poleAt(model, J2000).distanceTo(poleAt(model, J2000 + 1234.567))).toBeLessThan(1e-9)
  })
})

describe('OrientationModel — суточное вращение', () => {
  const uprightBody = (attrs: RotationAttrs = {}) =>
    makeActor({ ascendingNode: 0, inclination: 0, meridianAngle: 0, period: 24, direction: 1, ...attrs })

  it('за сидерический период тело делает ровно один оборот', () => {
    const model = new OrientationModel(uprightBody({ period: EARTH_SIDEREAL_HOURS }))

    const marker = new Vector3(1, 0, 0)
    const start = marker.clone().applyQuaternion(model.getQuaternion(J2000))
    const afterDay = marker.clone().applyQuaternion(model.getQuaternion(J2000 + EARTH_SIDEREAL_HOURS / 24))

    // допуск с запасом: вычитание больших JD съедает ~7 знаков мантиссы
    expect(afterDay.distanceTo(start)).toBeLessThan(1e-7)
  })

  it('прямое вращение: за четверть периода точка экватора уходит с +X на -Z', () => {
    const model = new OrientationModel(uprightBody())

    const quarter = new Vector3(1, 0, 0).applyQuaternion(model.getQuaternion(J2000 + 0.25))

    expect(quarter.x).toBeCloseTo(0, 9)
    expect(quarter.z).toBeCloseTo(-1, 9)
  })

  it('ретроградное вращение (direction=-1) идёт в обратную сторону', () => {
    const model = new OrientationModel(uprightBody({ direction: -1 }))

    const quarter = new Vector3(1, 0, 0).applyQuaternion(model.getQuaternion(J2000 + 0.25))

    expect(quarter.x).toBeCloseTo(0, 9)
    expect(quarter.z).toBeCloseTo(1, 9)
  })

  it('meridianAngle задаёт фазу вращения на эпоху J2000', () => {
    const model = new OrientationModel(uprightBody({ meridianAngle: 90 }))

    const marker = new Vector3(1, 0, 0).applyQuaternion(model.getQuaternion(J2000))

    expect(marker.x).toBeCloseTo(0, 9)
    expect(marker.z).toBeCloseTo(-1, 9)
  })
})

describe('OrientationModel — экваториальная рамка (полюс без спина)', () => {
  it('полюсный кватернион даёт то же направление полюса и не зависит от фазы вращения', () => {
    const body = makeActor({ ascendingNode: 49.5, inclination: 25.19, meridianAngle: 133.7, period: 24.6 })
    const model = new OrientationModel(body)

    const poleFromFull = new Vector3(0, 1, 0).applyQuaternion(model.getQuaternion(J2000 + 42))
    const poleFromFrame = new Vector3(0, 1, 0).applyQuaternion(model.getPoleQuaternion())

    expect(poleFromFrame.distanceTo(poleFromFull)).toBeLessThan(1e-9)
    // рамка не вращается: локальный X не зависит от meridianAngle
    const other = new OrientationModel(makeActor({ ascendingNode: 49.5, inclination: 25.19, meridianAngle: 0, period: 24.6 }))
    const x1 = new Vector3(1, 0, 0).applyQuaternion(model.getPoleQuaternion())
    const x2 = new Vector3(1, 0, 0).applyQuaternion(other.getPoleQuaternion())
    expect(x1.distanceTo(x2)).toBeLessThan(1e-12)
  })
})

describe('OrientationModel — fallback без строки rotation', () => {
  it('наклон берётся из axialTilt как в легаси rotateX(-tilt), спин — из rotationPeriod', () => {
    const model = new OrientationModel(makeActor(null, { axialTilt: 30, rotationPeriod: 10 }))

    const pole = poleAt(model, J2000)
    const tilt = (30 * Math.PI) / 180

    expect(pole.x).toBeCloseTo(0, 10)
    expect(pole.y).toBeCloseTo(Math.cos(tilt), 10)
    expect(pole.z).toBeCloseTo(-Math.sin(tilt), 10)

    // спин присутствует: через 2.5 часа (четверть периода) фаза сместилась
    const start = new Vector3(1, 0, 0).applyQuaternion(model.getQuaternion(J2000))
    const later = new Vector3(1, 0, 0).applyQuaternion(model.getQuaternion(J2000 + 2.5 / 24))
    expect(later.distanceTo(start)).toBeGreaterThan(0.1)
  })

  it('нулевой период не приводит к NaN', () => {
    const model = new OrientationModel(makeActor(null, { axialTilt: 0, rotationPeriod: 0 }))

    const pole = poleAt(model, J2000 + 5)

    expect(Number.isFinite(pole.x + pole.y + pole.z)).toBe(true)
  })
})
