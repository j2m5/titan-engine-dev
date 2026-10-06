import { smoothstep } from 'three/src/math/MathUtils'
import { STAR_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'

/** Ручки свечения издалека (config star.farGlowGain / star.farGlowFadePixels) */
export interface StarFarGlow {
  /** Множитель энергии в дальнем режиме, 12 px и мельче; 1 — выключено */
  gain: number
  /** Видимый диаметр в пикселях, с которого множитель равен 1 */
  fadePixels: number
}

/**
 * Множитель энергии звезды по видимому диаметру в пикселях. Блум видит только
 * яркие пиксели, а дальше переключения LOD звезда — всегда 12 px, поэтому её
 * свечение растёт только энергией. Одна функция на оба уровня LOD: на
 * дистанции переключения диск и билборд получают одно число.
 */
export function starFarGlowGain(pixels: number, gain: number, fadePixels: number): number {
  return gain + (1 - gain) * smoothstep(pixels, STAR_IMPOSTOR_PIXELS, fadePixels)
}
