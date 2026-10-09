import type { Actor } from '@/core/models/Actor'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { SolarMass } from '@/core/constants'
import { primaryOf } from '@/core/bodyInfo/primaryOf'
import type { BodyOrbit, BodyPhysics, BodyReference, BodyRotation, RelativeValue } from '@/core/bodyInfo/types'

/** Гравитационная постоянная, СИ */
const G_SI: number = 6.674e-11
/** Скорость света, м/с */
const C_SI: number = 299792458
const EARTH_MASS_KG: number = 5.972e24
const JUPITER_MASS_KG: number = 1.898e27
const EARTH_RADIUS_KM: number = 6371
const JUPITER_RADIUS_KM: number = 69911
const SUN_RADIUS_KM: number = 695700
/** Эффективная температура Солнца, K — нормировка светимости */
const SUN_TEMPERATURE_K: number = 5772

const STELLAR: readonly string[] = ['star', 'giantStar', 'whiteDwarf', 'pulsar', 'blackHole']
const LUMINOUS: readonly string[] = ['star', 'giantStar', 'whiteDwarf', 'brownDwarf']

function relativeMass(kind: string, massKg: number): RelativeValue | null {
  if (kind === 'planet') return { value: massKg / EARTH_MASS_KG, unit: 'M⊕' }
  if (kind === 'brownDwarf') return { value: massKg / JUPITER_MASS_KG, unit: 'M♃' }
  if (STELLAR.includes(kind)) return { value: massKg / SolarMass, unit: 'M☉' }

  return null
}

function relativeRadius(kind: string, radiusKm: number): RelativeValue | null {
  if (kind === 'planet') return { value: radiusKm / EARTH_RADIUS_KM, unit: 'R⊕' }
  if (kind === 'brownDwarf') return { value: radiusKm / JUPITER_RADIUS_KM, unit: 'R♃' }
  if (kind === 'star' || kind === 'giantStar') return { value: radiusKm / SUN_RADIUS_KM, unit: 'R☉' }

  return null
}

function physicsOf(actor: Actor, kind: string): BodyPhysics | null {
  const massKg: number = actor.physicalObject?.getAttribute('mass', 0) ?? 0
  const radiusKm: number = actor.physicalObject?.getAttribute('radius', 0) ?? 0

  if (massKg <= 0 || radiusKm <= 0) return null

  const temperature: number = actor.physicalObject?.getAttribute('temperature', 0) ?? 0
  const radiusM: number = radiusKm * 1000
  const blackHole: boolean = kind === 'blackHole'
  const gm: number = G_SI * massKg

  return {
    massKg,
    radiusKm,
    relativeMass: relativeMass(kind, massKg),
    relativeRadius: relativeRadius(kind, radiusKm),
    // кг/м³ → г/см³
    densityGcm3: blackHole ? null : massKg / ((4 / 3) * Math.PI * radiusM ** 3) / 1000,
    gravityMs2: blackHole ? null : gm / radiusM ** 2,
    escapeKms: blackHole ? null : Math.sqrt((2 * gm) / radiusM) / 1000,
    schwarzschildKm: blackHole ? (2 * gm) / C_SI ** 2 / 1000 : null,
    temperatureK: !blackHole && temperature > 0 ? temperature : null,
    diskTemperatureK: blackHole && temperature > 0 ? temperature : null,
    luminositySun:
      temperature > 0 && LUMINOUS.includes(kind)
        ? (radiusKm / SUN_RADIUS_KM) ** 2 * (temperature / SUN_TEMPERATURE_K) ** 4
        : null
  }
}

/**
 * Вращение — из той же модели, что крутит сцену: строка вращения, иначе
 * физобъект. У чёрной дыры rotationPeriod физобъекта — период вращения
 * аккреционного диска (BlackHoleParameters), а не самой дыры: без строки
 * вращения блока нет.
 */
function rotationOf(actor: Actor, kind: string): BodyRotation | null {
  if (kind === 'blackHole' && !actor.rotation) return null

  const orientation: OrientationModel = new OrientationModel(actor)

  if (!(orientation.period > 0)) return null

  return {
    periodHours: orientation.period,
    axialTiltDeg: orientation.inclination,
    retrograde: orientation.direction === -1
  }
}

function orbitOf(actor: Actor): BodyOrbit | null {
  if (!actor.orbit) return null

  const model: KeplerianModel = new KeplerianModel(actor)

  if (!(model.semiMajorAxis > 0)) return null

  return {
    semiMajorAxisAu: model.semiMajorAxis,
    eccentricity: model.eccentricity,
    inclinationDeg: model.inclination,
    periodDays: model.isElliptic ? model.period : null
  }
}

/** Справка о теле для карточки: значения с единицами в именах полей, без форматирования */
export function describeBody(actor: Actor): BodyReference {
  const kind: string = actor.category?.getAttribute('alias') ?? ''

  return {
    name: actor.getAttribute('name', ''),
    typeLabel: actor.category?.getAttribute('name') ?? '',
    primaryName: primaryOf(actor)?.getAttribute('name') ?? null,
    physics: physicsOf(actor, kind),
    rotation: rotationOf(actor, kind),
    orbit: orbitOf(actor)
  }
}
