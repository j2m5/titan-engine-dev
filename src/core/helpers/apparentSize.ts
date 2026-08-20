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

/**
 * Видимый размер импостора белого карлика в пикселях. Общая константа: по ней
 * и рисуется билборд, и выбирается расстояние переключения LOD.
 * Разъехавшись, эти два числа дают скачок размера диска в момент переключения.
 *
 * ВДВОЕ меньше звёздных 12, и это не косметика. Импостор — пол видимого
 * размера: объект мельче порога всё равно рисуется порогом. Значит два тела за
 * своими дистанциями переключения выходят на экран ОДНОГО размера, какими бы
 * разными они ни были, — у пары Сириуса это стирает разницу радиусов в 204
 * раза, и карлик читается не мельче главной звезды.
 *
 * Полного порядка это не возвращает (двукратная разница против двухсоткратной),
 * но убирает инверсию: карлик обязан быть меньше соседа, а не крупнее. Шесть
 * пикселей — примерно нижняя граница, на которой AA-кромка ещё рисует диск, а
 * не мутную точку.
 */
export const WHITE_DWARF_IMPOSTOR_PIXELS: number = 6

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
 * Мировой размер, дающий заданное число пикселей на заданном расстоянии.
 * Обратная задача к apparentSizeAtDistance, и считаться обязана тем же
 * frameHeightAt: по ней импосторы держат пол видимого размера, и своя копия
 * формулы означала бы пол не на том числе пикселей, что обещан.
 */
export function worldSizeForPixels(
  pixels: number,
  distance: number,
  fovDegrees: number,
  viewportHeight: number
): number {
  return (pixels / viewportHeight) * frameHeightAt(distance, fovDegrees)
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
