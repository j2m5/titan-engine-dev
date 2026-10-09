/**
 * Справка и замер для карточки объекта. Значения без форматирования, в
 * единицах из имён полей: форматирует интерфейс.
 */

export type RelativeUnit = 'M⊕' | 'M♃' | 'M☉' | 'R⊕' | 'R♃' | 'R☉'

export interface RelativeValue {
  value: number
  unit: RelativeUnit
}

export interface BodyPhysics {
  massKg: number
  radiusKm: number
  relativeMass: RelativeValue | null
  relativeRadius: RelativeValue | null
  densityGcm3: number | null
  gravityMs2: number | null
  escapeKms: number | null
  schwarzschildKm: number | null
  temperatureK: number | null
  /** У чёрной дыры temperature физобъекта — температура аккреционного диска (BlackHoleParameters) */
  diskTemperatureK: number | null
  luminositySun: number | null
}

export interface BodyRotation {
  periodHours: number
  axialTiltDeg: number
  retrograde: boolean
}

export interface BodyOrbit {
  semiMajorAxisAu: number
  eccentricity: number
  inclinationDeg: number
  periodDays: number | null
}

export interface BodyReference {
  name: string
  typeLabel: string
  primaryName: string | null
  physics: BodyPhysics | null
  rotation: BodyRotation | null
  orbit: BodyOrbit | null
}

export interface BodyLive {
  distanceKm: number
  starDistanceKm: number | null
  orbitalSpeedKms: number | null
}
