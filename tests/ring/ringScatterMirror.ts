/**
 * CPU-зеркало рассеяния кольца из RingShaderTemplate.
 *
 * ВАЖНО: менять строго синхронно с
 * src/core/materials/shaders/lib/RingShaderTemplate.ts — числовые тесты
 * инверсии проверяют именно эту реализацию, GLSL обязан повторять её один
 * в один.
 *
 * Соглашение о знаках: cosTheta = +1 — звезда за спиной камеры, cosTheta = -1
 * — камера смотрит сквозь кольцо на звезду.
 */

/** Показатель обратного лепестка: форма, а не элемент вида */
export const RING_OPPOSITION_G: number = 0.3

/** Хеньи–Гринштейн в нормировке «изотропное рассеяние равно единице» */
export function ringPhase(cosTheta: number, g: number): number {
  const g2: number = g * g

  return (1 - g2) / Math.pow(1 + g2 - 2 * g * cosTheta, 1.5)
}

/**
 * Рассеянная яркость в долях базового цвета. Прошедший свет гаснет с
 * оптической толщей, отражённый — насыщается; вместе с покрытием это даёт
 * максимум на средней плотности.
 */
export function ringScatteredBrightness(
  cosTheta: number,
  alpha: number,
  forwardScattering: number,
  oppositionSurge: number,
  densityExtinction: number
): number {
  const transmit: number = Math.exp(-densityExtinction * alpha)
  const reflectance: number = 1 - transmit

  const forward: number = ringPhase(cosTheta, -forwardScattering)
  const back: number = ringPhase(cosTheta, RING_OPPOSITION_G)

  return transmit * forward + reflectance * oppositionSurge * back
}
