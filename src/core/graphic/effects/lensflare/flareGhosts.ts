import { FLUX_REFERENCE_HEIGHT } from './flareGrid'

/**
 * Призраки анаморфного объектива: изображения диафрагмы — вертикальные овалы
 * фиксированного размера (доли высоты кадра), по оси «источник — центр кадра».
 * CPU-модуль: таблица, профили и фотометрия; GLSL FlareGhostMaterial
 * собирается из этих чисел.
 */

export type GhostProfile = 'disc' | 'ring'

export interface FlareGhost {
  /** Положение: центр призрака g = m·s, s — источник в координатах кадра */
  m: number
  /** Полувысота овала, доля высоты кадра */
  radius: number
  profile: GhostProfile
  /** Оттенок; нормируется по яркости */
  tint: readonly [number, number, number]
  /** Доля потока источника, относительная: абсолют задаёт калибровка */
  share: number
}

/** Полуширина / полувысота овала: вертикальный — анаморфная подпись */
export const GHOST_SQUEEZE = 0.6
/** Ширина мягкого края диска, доля радиуса */
export const DISC_EDGE = 0.15
/** Обод диска: прибавка яркости и ширина, центр — у начала мягкого края */
export const DISC_RIM_GAIN = 0.35
export const DISC_RIM_WIDTH = 0.08
/** Ширина кольца, доля радиуса */
export const RING_WIDTH = 0.06
/** Пиковая экранная яркость, ниже которой квад призрака схлопывается */
export const GHOST_CUTOFF = 1e-3

export const FLARE_GHOSTS: readonly FlareGhost[] = [
  { m: 0.75, radius: 0.025, profile: 'disc', tint: [0.55, 0.85, 1.0], share: 0.5 },
  { m: 0.45, radius: 0.06, profile: 'ring', tint: [0.35, 0.55, 1.0], share: 0.3 },
  { m: 0.2, radius: 0.035, profile: 'disc', tint: [0.35, 0.95, 0.85], share: 0.4 },
  { m: -0.15, radius: 0.09, profile: 'disc', tint: [0.5, 0.45, 1.0], share: 0.25 },
  { m: -0.4, radius: 0.03, profile: 'disc', tint: [1.0, 0.72, 0.35], share: 0.5 },
  { m: -0.7, radius: 0.05, profile: 'ring', tint: [0.55, 0.85, 1.0], share: 0.35 },
  { m: -1.0, radius: 0.12, profile: 'disc', tint: [0.35, 0.55, 1.0], share: 0.15 },
  { m: -1.3, radius: 0.04, profile: 'disc', tint: [0.45, 1.0, 0.8], share: 0.4 }
]

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/** Профиль по нормированному радиусу ρ (1 — край овала) */
export function ghostProfile(rho: number, profile: GhostProfile): number {
  if (profile === 'ring') {
    const d = (rho - 1) / RING_WIDTH
    return Math.exp(-d * d)
  }
  const rim = (rho - (1 - DISC_EDGE)) / DISC_RIM_WIDTH
  return (1 - smoothstep(1 - DISC_EDGE, 1, rho)) * (1 + DISC_RIM_GAIN * Math.exp(-rim * rim))
}

const PROFILE_STEPS = 20000
const PROFILE_SPAN = 2

/** Интеграл профиля по нормированной плоскости: 2π ∫ f(ρ) ρ dρ */
export function profileIntegral(profile: GhostProfile): number {
  const h = PROFILE_SPAN / PROFILE_STEPS
  let sum = 0
  for (let i = 0; i < PROFILE_STEPS; i++) {
    const rho = (i + 0.5) * h
    sum += ghostProfile(rho, profile) * rho
  }
  return 2 * Math.PI * sum * h
}

/** Максимум профиля */
export function profilePeak(profile: GhostProfile): number {
  let peak = 0
  for (let i = 0; i <= PROFILE_STEPS; i++) peak = Math.max(peak, ghostProfile((i * PROFILE_SPAN) / PROFILE_STEPS, profile))
  return peak
}

/** ρ, за которым профиль ниже 1e-3 пика — граница квада */
export function profileExtent(profile: GhostProfile): number {
  return profile === 'ring' ? 1 + RING_WIDTH * Math.sqrt(Math.log(1000)) : 1
}

/** Оттенок с единичной яркостью (Rec. 709) */
export function lumaNormalized(tint: readonly [number, number, number]): [number, number, number] {
  const luma = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2]
  return [tint[0] / luma, tint[1] / luma, tint[2] / luma]
}

/** Виньетирование: (1 − r²)^p, r — расстояние источника до угла кадра в долях; p = 0 — без него */
export function ghostVignette(source: readonly [number, number], aspect: number, power: number): number {
  const corner = 0.5 * Math.hypot(aspect, 1)
  const r = Math.min(Math.hypot(source[0], source[1]) / corner, 1)
  return Math.pow(Math.max(1 - r * r, 1e-6), power)
}

/** Энергия без калибровки: доля потока / площадь профиля (R · R·q · интеграл) */
function rawEnergy(ghost: FlareGhost): number {
  return ghost.share / (ghost.radius * ghost.radius * GHOST_SQUEEZE * profileIntegral(ghost.profile))
}

/**
 * Калибровка (расчёт, не замер): звезда 12 px при farGlowGain 3 (поток 3400)
 * в центре кадра при intensity 0.1 даёт самый яркий призрак 0.05 до AgX.
 */
export const GHOST_REFERENCE = { fluxPixels: 3400, peak: 0.05, intensity: 0.1 } as const

export const GHOST_SCALE: number = (() => {
  const fluxFrame = GHOST_REFERENCE.fluxPixels / FLUX_REFERENCE_HEIGHT ** 2
  const brightest = Math.max(...FLARE_GHOSTS.map((g) => rawEnergy(g) * profilePeak(g.profile) * fluxFrame))
  return GHOST_REFERENCE.peak / (GHOST_REFERENCE.intensity * brightest)
})()

/** Яркость профиля 1 на единицу потока (доли высоты кадра²), с калибровкой */
export function ghostEnergy(ghost: FlareGhost): number {
  return GHOST_SCALE * rawEnergy(ghost)
}

/** Пиковая экранная яркость призрака белого источника */
export function ghostPeakOnScreen(
  ghost: FlareGhost,
  fluxFrame: number,
  vignette: number,
  ghostAmount: number,
  intensity: number
): number {
  return ghostEnergy(ghost) * profilePeak(ghost.profile) * fluxFrame * vignette * ghostAmount * intensity
}
