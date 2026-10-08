import { FLUX_REFERENCE_HEIGHT } from './flareGrid'

/**
 * Призраки анаморфного объектива: мягкие вертикальные овалы фиксированного
 * размера (доли высоты кадра) по оси «источник — центр кадра». Облик —
 * по Shadertoy 4sX3Rs (mu6k): купола и ореол без ободков, каналы R/G/B
 * разнесены по оси. CPU-модуль: таблица, профили и фотометрия; GLSL
 * FlareGhostMaterial собирается из этих чисел.
 */

/**
 * Профиль по нормированному радиусу ρ (1 — край овала, за ним ноль):
 * купол 1 − ρ^p — p 1.6 острый центр, 2.4 купол, 5.5 плоский диск с мягким
 * краем; ореол — лоренциан с ядром core (доля радиуса), доведённый до нуля на ρ = 1
 */
export type GhostProfile = { kind: 'dome'; power: number } | { kind: 'halo'; core: number }

export interface FlareGhost {
  /** Положение зелёного канала: центр призрака g = m·s, s — источник в координатах кадра */
  m: number
  /** Полувысота овала, доля высоты кадра */
  radius: number
  profile: GhostProfile
  /** Оттенок; нормируется по яркости */
  tint: readonly [number, number, number]
  /** Пиковая яркость относительно других призраков: абсолют задаёт калибровка */
  peak: number
  /** Разнос каналов по оси: красный в m·(1 − δ)·s, синий в m·(1 + δ)·s */
  spread: number
}

/** Полуширина / полувысота овала: вертикальный — анаморфная подпись */
export const GHOST_SQUEEZE = 0.6
/** Пиковая экранная яркость, ниже которой квад призрака схлопывается */
export const GHOST_CUTOFF = 1e-3

/**
 * Семейства референса. Его положения заданы в искажённом пространстве
 * uv·|uv|; здесь — эквивалентные m и радиусы для источника на ~0.4 высоты
 * кадра от центра. Пики и оттенки — соотношения каналов референса.
 */
export const FLARE_GHOSTS: readonly FlareGhost[] = [
  // f6: острое пурпурное пятно между источником и центром
  { m: 0.22, radius: 0.039, profile: { kind: 'dome', power: 1.6 }, tint: [1, 0.5, 0.83], peak: 0.049, spread: 0.077 },
  // f4: тёплый купол за центром
  { m: -0.31, radius: 0.105, profile: { kind: 'dome', power: 2.4 }, tint: [1, 0.83, 0.5], peak: 0.066, spread: 0.11 },
  // f5: огромный бледный диск; каналы разъезжаются в радугу
  { m: -0.3, radius: 0.33, profile: { kind: 'dome', power: 5.5 }, tint: [1, 1, 1], peak: 0.026, spread: 0.5 },
  // f2: большой мягкий ореол далеко за центром
  { m: -1.4, radius: 0.8, profile: { kind: 'halo', core: 0.26 }, tint: [1, 0.92, 0.84], peak: 0.3, spread: 0.059 }
]

export function ghostProfile(rho: number, profile: GhostProfile): number {
  if (rho >= 1) return 0
  if (profile.kind === 'halo') {
    const c2 = profile.core * profile.core
    const edge = 1 / (1 + 1 / c2)
    return (1 / (1 + (rho * rho) / c2) - edge) / (1 - edge)
  }
  return 1 - Math.pow(rho, profile.power)
}

const PROFILE_STEPS = 20000

/** Интеграл профиля по нормированному кругу: 2π ∫₀¹ f(ρ) ρ dρ */
export function profileIntegral(profile: GhostProfile): number {
  const h = 1 / PROFILE_STEPS
  let sum = 0
  for (let i = 0; i < PROFILE_STEPS; i++) {
    const rho = (i + 0.5) * h
    sum += ghostProfile(rho, profile) * rho
  }
  return 2 * Math.PI * sum * h
}

/** Центры каналов R, G, B в координатах кадра; chromatic — множитель разноса */
export function ghostChannelCenters(
  ghost: FlareGhost,
  source: readonly [number, number],
  chromatic: number
): [[number, number], [number, number], [number, number]] {
  const k = ghost.m * ghost.spread * chromatic
  const at = (m: number): [number, number] => [m * source[0], m * source[1]]
  return [at(ghost.m - k), at(ghost.m), at(ghost.m + k)]
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

/**
 * Сжатие потока источника: до колена яркость призраков линейна, выше —
 * степень GHOST_FLUX_GAMMA. Колено — поток импостора звезды (замер на Солнце
 * 2026-10-08: ~500 px·яркость); диск вблизи даёт 1500–2000, кольцо крупного
 * диска растёт с размером — без сжатия импостор в 4 раза тусклее облика вблизи
 */
export const GHOST_FLUX_KNEE_PIXELS = 500
export const GHOST_FLUX_GAMMA = 0.2

const FLUX_KNEE: number = GHOST_FLUX_KNEE_PIXELS / FLUX_REFERENCE_HEIGHT ** 2

/** Сжатый поток, доли высоты кадра² */
export function fluxResponse(fluxFrame: number): number {
  return fluxFrame <= FLUX_KNEE ? fluxFrame : FLUX_KNEE * Math.pow(fluxFrame / FLUX_KNEE, GHOST_FLUX_GAMMA)
}

/**
 * Множитель потока копии: сжатый поток окна / поток окна. Копии
 * раздробленного диска делят его так, что вместе дают яркость одного
 * источника с общим потоком; одиночный источник — сжатие своего потока
 */
export function sourceGain(windowFlux: number): number {
  return windowFlux > 0 ? fluxResponse(windowFlux) / windowFlux : 0
}

/** Эффективное число копий в окне: (ΣF)² / ΣF²; тусклые источники почти не весят */
export function effectiveCopies(windowFlux: number, windowFluxSquared: number): number {
  return windowFluxSquared > 0 ? (windowFlux * windowFlux) / windowFluxSquared : 0
}

/**
 * Гашение по числу копий: мягкие копии сливаются, пока диск меньше ~400 px;
 * дальше мелкий призрак рассыпается в кольцо пятен. Замер GPU: 200 px — до 7
 * копий, 550–900 px — не меньше 11.7 у любой копии (окно видит часть кольца)
 */
export const GHOST_COPIES_FADE = { start: 7, end: 11 } as const

/** Множитель призраков по числу копий: smoothstep от 1 до 0 на [start, end] */
export function ghostCopiesFade(copies: number): number {
  const { start, end } = GHOST_COPIES_FADE
  const t = Math.min(Math.max((copies - start) / (end - start), 0), 1)
  return 1 - t * t * (3 - 2 * t)
}

/**
 * Калибровка — облик, принятый владельцем 2026-10-08: Солнце диском 25–30 px
 * (замер потока ≈1800) в центре кадра при intensity 0.1 даёт самый яркий
 * призрак 0.0265 до AgX
 */
export const GHOST_REFERENCE = { fluxPixels: 1800, peak: 0.0265, intensity: 0.1 } as const

export const GHOST_SCALE: number = (() => {
  const response = fluxResponse(GHOST_REFERENCE.fluxPixels / FLUX_REFERENCE_HEIGHT ** 2)
  const brightest = Math.max(...FLARE_GHOSTS.map((g) => g.peak))
  return GHOST_REFERENCE.peak / (GHOST_REFERENCE.intensity * response * brightest)
})()

/** Яркость пика профиля на единицу сжатого потока (доли высоты кадра²), с калибровкой */
export function ghostEnergy(ghost: FlareGhost): number {
  return GHOST_SCALE * ghost.peak
}

/** Пиковая экранная яркость призрака одиночного белого источника */
export function ghostPeakOnScreen(
  ghost: FlareGhost,
  fluxFrame: number,
  vignette: number,
  ghostAmount: number,
  intensity: number
): number {
  return ghostEnergy(ghost) * fluxResponse(fluxFrame) * vignette * ghostAmount * intensity
}
