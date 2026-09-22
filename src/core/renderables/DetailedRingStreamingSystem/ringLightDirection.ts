import type { Vector3 } from 'three'

/** Ниже этой длины (units сцены) светило считается лежащим в начале ring-local */
const AT_ORIGIN_EPSILON = 1e-6

/**
 * Единичное направление на светило в ring-local для uDustLightDirRing.
 *
 * Кольцо: светило далеко от центра планеты — вектор к нему из начала координат.
 * Пояс: светило в самом начале координат, вектор нулевой — берётся направление
 * от камеры к началу. Сэмплы дымки и камни лежат в тысячах км от камеры при
 * радиусе пояса в десятки а.е., угловая ошибка такой замены пренебрежима.
 * Камера тоже в начале — ось X, как дефолт юниформа.
 */
export function ringLightDirection(lightLocal: Vector3, cameraLocal: Vector3, out: Vector3): Vector3 {
  if (lightLocal.lengthSq() > AT_ORIGIN_EPSILON * AT_ORIGIN_EPSILON) {
    return out.copy(lightLocal).normalize()
  }
  if (cameraLocal.lengthSq() > AT_ORIGIN_EPSILON * AT_ORIGIN_EPSILON) {
    return out.copy(cameraLocal).negate().normalize()
  }
  return out.set(1, 0, 0)
}
