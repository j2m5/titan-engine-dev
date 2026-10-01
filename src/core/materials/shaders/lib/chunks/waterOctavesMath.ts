// CPU-зеркало математики воды: октавы ряби, вес по футпринту, блик, поглощение.
// Без импортов: модуль берут и код рельефа, и сборщики GLSL-чанков. GLSL-двойники обязаны совпадать формулами.

export type Vec3 = [number, number, number]

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Период самой мелкой октавы ряби, м. */
export const WATER_DETAIL_PERIOD_METERS = 40
/** Обёртка домена мелких октав, м: каждый период обязан её делить, иначе шов на границе патчей. */
export const WATER_DETAIL_WRAP_METERS = 40960
/** Периоды октав ряби, м. */
export const WATER_RIPPLE_PERIODS_METERS: readonly number[] = [2560, 640, 160, 40, 10]
/** Эффективные периоды волн, м — только для весов (пары анизотропии — геометрическое среднее). */
export const WATER_WAVE_PERIODS_METERS: readonly number[] = [3000, 9000, 27000, 90000]
/** Скорость ряби с периодом 3000 м, м/с. */
export const WATER_RIPPLE_REF_SPEED_MPS = 6
/** Отражательная способность воды при нормальном падении. */
export const WATER_GLINT_F0 = 0.02
/** Потолок блика (линейная яркость). */
export const WATER_GLINT_CEILING = 4
/** Средняя дисперсия наклона одной октавы (замер waternormals.jpg: (nx²+ny²)/max(nz,0.05)²). */
export const WATER_OCTAVE_SLOPE_VARIANCE = 0.06427
/** Пол α²: держит степень лепестка конечной. */
export const WATER_MIN_ALPHA2 = 1e-4

/** Скорость ряби ∝ √λ, м/с. */
export function rippleSpeedMps(periodMeters: number): number {
  return WATER_RIPPLE_REF_SPEED_MPS * Math.sqrt(periodMeters / 3000)
}

/** Вес октавы: 1 при λ ≥ 4f, 0 при λ ≤ 2f. */
export function octaveWeight(periodMeters: number, footprintMeters: number): number {
  return smoothstep(2 * footprintMeters, 4 * footprintMeters, periodMeters)
}

/** Футпринт пикселя на поверхности, м; μv клампится к 0.2 — скользящий взгляд конечен. */
export function footprintMeters(distanceMeters: number, pixelAngle: number, muV: number): number {
  return (distanceMeters * pixelAngle) / Math.max(muV, 0.2)
}

/** α² блика: базовая шероховатость плюс дисперсия погасших октав; weights — веса всех учитываемых октав. */
export function glintAlpha2(baseRoughness: number, weights: readonly number[], strength: number): number {
  let faded = 0
  for (const w of weights) faded += (1 - w) * strength * strength * WATER_OCTAVE_SLOPE_VARIANCE
  return Math.max(baseRoughness * baseRoughness + faded, WATER_MIN_ALPHA2)
}

/** Блик Блинна-Фонга с нормировкой лепестка и Шликом; зажат потолком, 0 при N·L ≤ 0. */
export function waterGlint(nDotH: number, vDotH: number, nDotL: number, alpha2: number): number {
  if (nDotL <= 0) return 0
  const p = 2 / Math.max(alpha2, WATER_MIN_ALPHA2) - 2
  const fresnel = WATER_GLINT_F0 + (1 - WATER_GLINT_F0) * (1 - Math.min(Math.max(vDotH, 0), 1)) ** 5
  const lobe = ((p + 8) / (8 * Math.PI)) * Math.max(nDotH, 0) ** p
  return Math.min(lobe * nDotL * fresnel, WATER_GLINT_CEILING)
}

/** Пропускание столба воды по каналам: exp(−σ·глубина/μv), μv ≥ 0.2. */
export function waterTransmittance(depthMeters: number, muV: number, sigma: Vec3): Vec3 {
  const path = depthMeters / Math.max(muV, 0.2)
  return [Math.exp(-sigma[0] * path), Math.exp(-sigma[1] * path), Math.exp(-sigma[2] * path)]
}

/** Слой поглощения для альфа-смешивания: C·(1 − T) = color·alpha; alpha — по яркости (1 − T). */
export function absorptionLayer(transmittance: Vec3, deepColor: Vec3): { color: Vec3; alpha: number } {
  const [t0, t1, t2] = transmittance
  const alpha = 1 - (0.2126 * t0 + 0.7152 * t1 + 0.0722 * t2)
  const k = Math.max(alpha, 1e-3)
  return {
    color: [
      Math.min((deepColor[0] * (1 - t0)) / k, 1),
      Math.min((deepColor[1] * (1 - t1)) / k, 1),
      Math.min((deepColor[2] * (1 - t2)) / k, 1)
    ],
    alpha
  }
}
