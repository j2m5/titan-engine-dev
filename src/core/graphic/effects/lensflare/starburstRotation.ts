import { Vector3, type Matrix4 } from 'three'

/**
 * Скаляр поворота маски старберста по ориентации камеры (приём Chapman'а).
 *
 * В расчёт входит ТОЛЬКО базис камеры: направление на источник света эффекту
 * неизвестно и известно быть не должно — он видит яркие пиксели, а не сцену.
 * Маска ведёт себя как грани объектива: доворачивается вместе с камерой и не
 * зависит от того, где стоит камера.
 */
const WORLD_UP: Vector3 = new Vector3(0, 1, 0)
const WORLD_FORWARD: Vector3 = new Vector3(0, 0, 1)

const cameraRight: Vector3 = new Vector3()
const cameraUp: Vector3 = new Vector3()

export function computeStarburstRotation(cameraMatrixWorld: Matrix4): number {
  const e: number[] | Float32Array = cameraMatrixWorld.elements

  // первые два столбца матрицы мира камеры — её правый и верхний векторы
  cameraRight.set(e[0], e[1], e[2])
  cameraUp.set(e[4], e[5], e[6])

  return cameraRight.dot(WORLD_FORWARD) + cameraUp.dot(WORLD_UP)
}
