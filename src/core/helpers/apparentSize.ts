import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

/**
 * Видимый размер импостора звезды в пикселях. Общая константа: по ней и
 * рисуется билборд, и выбирается расстояние переключения LOD. Разъехавшись,
 * эти два числа дают скачок размера диска в момент переключения.
 */
export const STAR_IMPOSTOR_PIXELS: number = 12

/**
 * Видимый размер импостора коричневого карлика в пикселях. Общая константа:
 * по ней и рисуется билборд, и выбирается расстояние переключения LOD.
 * Разъехавшись, эти два числа дают скачок размера диска в момент переключения.
 */
export const BROWN_DWARF_IMPOSTOR_PIXELS: number = 12

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
  // Обратная apparentSizeAtDistance, и высота кадра обязана считаться тем же
  // frameHeightAt: своя копия формулы — расхождение при первой же правке
  return (worldSize * viewportHeight) / (pixels * frameHeightAt(1, fovDegrees))
}

/**
 * Расстояние переключения LOD звезды: настоящий диск и билборд-импостор
 * занимают на нём одинаковое число пикселей (STAR_IMPOSTOR_PIXELS).
 * Константа зашита внутри намеренно — вызывающей стороне нечем её подменить.
 * radiusKm — физический радиус звезды в километрах.
 */
export function starLodSwitchDistance(radiusKm: number, fovDegrees: number, viewportHeight: number): number {
  return distanceForApparentSize(toThreeJSUnits(2 * radiusKm), STAR_IMPOSTOR_PIXELS, fovDegrees, viewportHeight)
}
