/**
 * CPU-зеркало средней полосы детали рельефа (TerrainMacroDetail.ts).
 * Единицы: радиус в км, результат macroFadeMetersFor — метры, остальное
 * безразмерно. Держать синхронно с GLSL.
 */

/**
 * Дистанция (в текселях диффуза), на которой тексель ≈ 1 экранному пикселю
 * при 1080p и fov ~50°: H / fov_rad ≈ 1237, с запасом ×1.2.
 */
export const MACRO_FADE_TEXEL_FACTOR = 1500

/** Начало fade относительно конца — общее для всех шкал детали (TerrainDetail, полоса). */
export const DETAIL_FADE_START_RATIO = 0.4

/**
 * Отношение амплитуды рельефа полосы к её периоду. Наклон нормали = (A/P)·grad:
 * домен задан в периодах, ∂/∂s = (1/P)·∂/∂q — чистое отношение, от радиуса тела
 * не зависит. 0.03 ≈ 90 м рельефа на 3-км период — стартовое число, приёмка владельца.
 */
export const MACRO_RELIEF_ASPECT = 0.03

/** Конец fade полосы по умолчанию: полоса включается там, где диффуз перестаёт нести информацию. */
export function macroFadeMetersFor(radiusKm: number, diffuseWidth: number): number {
  if (radiusKm <= 0 || diffuseWidth <= 0) return 0

  const texelMeters = (2 * Math.PI * radiusKm * 1000) / diffuseWidth

  return texelMeters * MACRO_FADE_TEXEL_FACTOR
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))

  return t * t * (3 - 2 * t)
}

/** Вес октавы: 1 пока период ≥ 2 px, плавно к 0 при footprint·f → 1. */
export function octaveWeight(footprint: number, frequency: number): number {
  return 1 - smoothstep(0.5, 1, footprint * frequency)
}

/** 1 до 0.4·fadeEnd, 0 за fadeEnd — как у шкал TerrainDetail. */
export function distFade(viewDistance: number, fadeEnd: number): number {
  return 1 - smoothstep(DETAIL_FADE_START_RATIO * fadeEnd, fadeEnd, viewDistance)
}

/** Угол наклона нормали полосой (радианы) от длины градиента fbm — зеркало строки нормали в чанке. */
export function macroTiltRadians(gradLen: number, normalScale: number, contrast: number): number {
  return Math.atan(normalScale * MACRO_RELIEF_ASPECT * contrast * gradLen)
}

/** Амплитуда по крутизне: равнина тише на influence, крутой склон (|slope|/macroSlopeRef ≥ 1) — полная. */
export function slopeGain(slopeLength: number, slopeInfluence: number): number {
  const s = Math.max(0, Math.min(1, slopeLength))

  return 1 - slopeInfluence + slopeInfluence * s
}

/** Амплитуда по cavity ∈ [−1, 1]: ямы тише, гребни громче; пол 0. */
export function cavityGain(cavity: number, cavityInfluence: number): number {
  return Math.max(0, 1 + cavityInfluence * cavity)
}

// --- Направленные формы склона (арка A средней полосы). Константы зеркалят
// #define чанка TerrainMacroDetail — менять строго синхронно.
export const STREAK_STRETCH = 6
/** Амплитуда/период струй: глубже относительно ширины, чем километровый fbm (0.03). */
export const MACRO_RELIEF_ASPECT_STREAK = 0.08
export const STREAK_PLANE_POW = 8
export const STREAK_PLANE_MIN_WEIGHT = 0.02
export const TERRACE_WOBBLE = 0.7
/** Доля периода под уступом; остальное — площадка. */
export const TERRACE_RISER = 0.3
export const TERRACE_SHADE = 0.07
/** Маска покрытия террас по значению fbm: ниже LO — нет полок, выше HI — полная. */
export const TERRACE_COVER_LO = 0.1
export const TERRACE_COVER_HI = 0.4
/** Дефолты гейта форм по абсолютному уклону (tan): 0.2 ≈ 11°, 0.45 ≈ 24°. */
export const DEFAULT_STRUCTURE_SLOPE_START = 0.2
export const DEFAULT_STRUCTURE_SLOPE_FULL = 0.45

/** Гейт форм от нормированного уклона s = |slope|/slopeRef: равнина 0, крутое 1. */
export function structureGate(
  slopeTan: number,
  start: number = DEFAULT_STRUCTURE_SLOPE_START,
  full: number = DEFAULT_STRUCTURE_SLOPE_FULL
): number {
  return smoothstep(start, full, slopeTan)
}

/** Покрытие террас от значения fbm (пятна полок на стене). */
export function terraceCoverage(fbmValue: number): number {
  return smoothstep(TERRACE_COVER_LO, TERRACE_COVER_HI, fbmValue)
}

/**
 * Профиль террасы, период 1: уступ — подъём smoothstep на [0, TERRACE_RISER],
 * площадка — линейный спад; value = rise − t обнуляется на концах периода.
 * derivative — по фазе: площадка −1 (уклон положе), уступ > 0 (круче).
 */
export function terraceProfile(phase: number): { value: number; derivative: number } {
  const t = phase - Math.floor(phase)
  const r = Math.max(0, Math.min(1, t / TERRACE_RISER))
  const rise = r * r * (3 - 2 * r)
  const dRise = t < TERRACE_RISER ? (6 * r * (1 - r)) / TERRACE_RISER : 0

  return { value: rise - t, derivative: dRise - 1 }
}

/** Веса плоскостей трипланара по единичному направлению: |dir|^POW, нормированные на сумму. */
export function triplanarWeights(dir: readonly [number, number, number]): [number, number, number] {
  const w: [number, number, number] = [
    Math.abs(dir[0]) ** STREAK_PLANE_POW,
    Math.abs(dir[1]) ** STREAK_PLANE_POW,
    Math.abs(dir[2]) ** STREAK_PLANE_POW
  ]
  const sum = Math.max(w[0] + w[1] + w[2], 1e-6)

  return [w[0] / sum, w[1] / sum, w[2] / sum]
}

/**
 * Цепное правило струй в плоскости: шум берётся в координатах
 * (вдоль/STRETCH, поперёк); noiseGradAlongAcross — его градиент по ним.
 * Возвращает градиент по исходным uv плоскости.
 */
export function streakGradient2D(
  d2: readonly [number, number],
  noiseGradAlongAcross: readonly [number, number]
): [number, number] {
  const p2: [number, number] = [-d2[1], d2[0]]
  const along = noiseGradAlongAcross[0] / STREAK_STRETCH
  const across = noiseGradAlongAcross[1]

  return [along * d2[0] + across * p2[0], along * d2[1] + across * p2[1]]
}
