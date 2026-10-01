// CPU-зеркало математики воды: октавы ряби, вес по футпринту, блик, поглощение.
// Без импортов: модуль берут и код рельефа, и сборщики GLSL-чанков. GLSL-двойники обязаны совпадать формулами.

export type Vec3 = [number, number, number]

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Период самой мелкой октавы ряби, м. */
export const WATER_DETAIL_PERIOD_METERS = 40
/** Обёртка домена мелких октав, м: 1024 (= WRAP_TILES, detailWrap.ts) периодов; каждый период обязан её делить. */
export const WATER_DETAIL_WRAP_METERS = WATER_DETAIL_PERIOD_METERS * 1024
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
/** Квадрат тангенциального усиления 1.5 трипланарной реориентации: дисперсия наклона октавы в нормали — 2.25·V. */
export const WATER_TRIPLANAR_SLOPE_GAIN2 = 2.25
/**
 * Амплитуда одной мелкой октавы: 1/√(4·5) — сумма дисперсий 5 мелких октав равна
 * дисперсии среднего 4 крупных (каждая крупная — 1/4 доля среднего, V/16).
 */
export const WATER_RIPPLE_OCTAVE_GAIN = 1 / Math.sqrt(20)
/** Угол пикселя до первого кадра, рад: номинал 50°/1080p (0 включил бы все октавы с орбиты). */
export const WATER_DEFAULT_PIXEL_ANGLE = (2 * Math.tan((50 * Math.PI) / 360)) / 1080
/** Пол α²: держит степень лепестка конечной. */
export const WATER_MIN_ALPHA2 = 1e-4
/** Потолок α²: степень лепестка p = 2/α² − 2 не уходит в минус. */
export const WATER_MAX_ALPHA2 = 1

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

/**
 * α² блика: r² + 2.25·(Σ(1 − wᵢ)·(s·gain)²·V мелких + Σ(1 − wₖ)·V/16 крупных) погасших октав.
 * Сила ряби s — только на мелкие; крупные входят долей 1/4 среднего.
 */
export function glintAlpha2(
  baseRoughness: number,
  rippleWeights: readonly number[],
  bigWeights: readonly number[],
  rippleStrength: number
): number {
  const amp = rippleStrength * WATER_RIPPLE_OCTAVE_GAIN
  let faded = 0
  for (const w of rippleWeights) faded += (1 - w) * amp * amp * WATER_OCTAVE_SLOPE_VARIANCE
  for (const w of bigWeights) faded += ((1 - w) * WATER_OCTAVE_SLOPE_VARIANCE) / 16
  const alpha2 = baseRoughness * baseRoughness + WATER_TRIPLANAR_SLOPE_GAIN2 * faded
  return Math.min(Math.max(alpha2, WATER_MIN_ALPHA2), WATER_MAX_ALPHA2)
}

/** Блик Блинна-Фонга с нормировкой лепестка и Шликом; зажат потолком, 0 при N·L ≤ 0. */
export function waterGlint(nDotH: number, vDotH: number, nDotL: number, alpha2: number): number {
  if (nDotL <= 0) return 0
  const p = 2 / Math.min(Math.max(alpha2, WATER_MIN_ALPHA2), WATER_MAX_ALPHA2) - 2
  const fresnel = WATER_GLINT_F0 + (1 - WATER_GLINT_F0) * (1 - Math.min(Math.max(vDotH, 0), 1)) ** 5
  const lobe = ((p + 8) / (8 * Math.PI)) * Math.max(nDotH, 0) ** p
  return Math.min(lobe * nDotL * fresnel, WATER_GLINT_CEILING)
}

/** Пропускание по каналам: T = exp(−σL), L = d·(1 + 1/max(μv, 0.1)) — вниз и обратно вверх по столбу. */
export function waterTransmittance(depthMeters: number, muV: number, sigma: Vec3): Vec3 {
  const path = depthMeters * (1 + 1 / Math.max(muV, 0.1))
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
