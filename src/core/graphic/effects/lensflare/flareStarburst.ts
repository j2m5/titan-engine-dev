import { FLUX_REFERENCE_HEIGHT } from './flareGrid'

/**
 * Starburst: шесть дифракционных лучей на сильном источнике. Яркость вдоль
 * луча I(r) = I₀·k / (1 + r·k/r₀)², поперёк — гаусс; k — растяжка канала по
 * длине волны. CPU-модуль: константы и фотометрия; GLSL FlareStarburstMaterial
 * собирается из этих чисел.
 */

/** Углы линий лучей в кадре, градусы: вертикаль и диагонали ±60° от неё; горизонтали нет */
export const STARBURST_ANGLES_DEG = [30, 90, 150] as const
/** Радиус ядра профиля r₀, доля высоты кадра */
export const STARBURST_CORE = 0.005
/** Ширина луча (гаусс), доля высоты кадра: 1.2 px половинного буфера на 1080p */
export const STARBURST_WIDTH = 0.0022
/** Растяжка картины по каналам ∝ длине волны: красный длиннее, синий короче */
export const STARBURST_DISPERSION = [0.83, 1.0, 1.22] as const
/** Экранная яркость, до которой квад покрывает лучи */
export const STARBURST_EPSILON = 1e-3
/** Потолок длины луча, доля высоты кадра */
export const STARBURST_MAX_LENGTH = 0.6
/** Спад луча к краю квада: доля 0.7 полуразмера — без изменений, у края — ноль; все три линии кончаются на h */
export const STARBURST_TAPER_START = 0.7
/** Экранная яркость, с которой луч читается после AgX — мера видимой длины */
export const STARBURST_VISIBLE_LEVEL = 0.02
/** Калибровка (расчёт, не замер): звезда 12 px (поток 3400) при intensity 0.1 — видимая длина 0.25 */
export const STARBURST_REFERENCE = { fluxPixels: 3400, visibleLength: 0.25, intensity: 0.1 } as const

/** Яркость луча на расстоянии r для канала с растяжкой k */
export function spikeIntensity(r: number, i0: number, k: number): number {
  return (i0 * k) / (1 + (r * k) / STARBURST_CORE) ** 2
}

/** κ: I₀ = κ·Φ (Φ — поток в долях высоты кадра²), по зелёному каналу */
export const STARBURST_KAPPA: number = (() => {
  const { fluxPixels, visibleLength, intensity } = STARBURST_REFERENCE
  const fluxFrame = fluxPixels / FLUX_REFERENCE_HEIGHT ** 2
  return (STARBURST_VISIBLE_LEVEL * (1 + visibleLength / STARBURST_CORE) ** 2) / (intensity * fluxFrame)
})()

/** Плавный вход по потоку (пиксели 1080p × яркость); порог ≤ 0 — вход открыт */
export function starburstWeight(fluxPixels: number, minFlux: number): number {
  if (minFlux <= 0) return 1
  const t = Math.min(Math.max((fluxPixels - minFlux) / minFlux, 0), 1)
  return t * t * (3 - 2 * t)
}

/** Расстояние, на котором экранная яркость канала k падает до level */
export function spikeReach(i0Screen: number, k: number, level: number): number {
  if (i0Screen * k <= level) return 0
  return (STARBURST_CORE / k) * (Math.sqrt((i0Screen * k) / level) - 1)
}

/** Полуразмер квада: красный (самый длинный) канал до ε, в пределах [r₀, потолок] */
export function starburstQuadHalfSize(i0Screen: number): number {
  const reach = spikeReach(i0Screen, STARBURST_DISPERSION[0], STARBURST_EPSILON)
  return Math.min(Math.max(reach, STARBURST_CORE), STARBURST_MAX_LENGTH)
}

/** Окно луча по расстоянию вдоль него: 1 до 0.7·h, 0 на h — зеркало GLSL FlareStarburstMaterial */
export function starburstWindow(along: number, halfSize: number): number {
  const t = Math.min(Math.max((along - STARBURST_TAPER_START * halfSize) / ((1 - STARBURST_TAPER_START) * halfSize), 0), 1)
  return 1 - t * t * (3 - 2 * t)
}

/** Видимая длина: зелёный канал до STARBURST_VISIBLE_LEVEL — для отчётов и тестов */
export function starburstVisibleLength(fluxPixels: number, amount: number, intensity: number): number {
  const i0Screen = STARBURST_KAPPA * (fluxPixels / FLUX_REFERENCE_HEIGHT ** 2) * amount * intensity
  return spikeReach(i0Screen, 1, STARBURST_VISIBLE_LEVEL)
}
