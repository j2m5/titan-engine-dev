import { degToRad } from 'three/src/math/MathUtils'

/**
 * Видимый размер импостора звезды в пикселях. Общая константа: по ней и
 * рисуется билборд, и выбирается расстояние переключения LOD. Разъехавшись,
 * эти два числа дают скачок размера диска в момент переключения.
 */
export const STAR_IMPOSTOR_PIXELS: number = 12

/** Высота кадра в мировых единицах на заданном расстоянии */
export function frameHeightAt(distance: number, fovDegrees: number): number {
  return 2 * Math.tan(degToRad(fovDegrees) / 2) * distance
}

/** Сколько пикселей занимает объект заданного мирового размера */
export function apparentSizeAtDistance(
  worldSize: number,
  distance: number,
  fovDegrees: number,
  viewportHeight: number
): number {
  return (worldSize / frameHeightAt(distance, fovDegrees)) * viewportHeight
}

/** Расстояние, на котором объект занимает заданное число пикселей */
export function distanceForApparentSize(
  worldSize: number,
  pixels: number,
  fovDegrees: number,
  viewportHeight: number
): number {
  return (worldSize * viewportHeight) / (pixels * 2 * Math.tan(degToRad(fovDegrees) / 2))
}
