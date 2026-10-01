import { Matrix4, Quaternion, Vector3 } from 'three'

/** Ближайшая поверхность под камерой, юниты сцены. */
export interface SurfaceProbe {
  /** Мировой центр тела. */
  center: Vector3
  /** Высота камеры над рельефом (водой, сферой) под ней. */
  altitude: number
  /** Радиус поверхности под камерой: R тела + высота рельефа. */
  surfaceRadius: number
}

/** Предел тангажа осмотра на месте от горизонта, радианы (89°): на 90° вертикаль и взгляд вырождаются. */
export const FREE_LOOK_MAX_PITCH = (89 * Math.PI) / 180

/**
 * Доля угла орбиты: h/(h+R). Далеко — 1 (прежняя чувствительность), у поверхности
 * перетаскивание на ширину окна сдвигает камеру на ~2π высот, а не на оборот тела.
 */
export function orbitAngleScale(altitude: number, surfaceRadius: number): number {
  if (altitude <= 0) return 0
  return altitude / (altitude + surfaceRadius)
}

/** Ниже ratio·R правая кнопка мыши — осмотр на месте, выше — орбита. */
export function isFreeLook(altitude: number, surfaceRadius: number, ratio: number): boolean {
  return altitude < ratio * surfaceRadius
}

const forward = new Vector3()
const cameraUp = new Vector3()
const horizon = new Vector3()
const look = new Vector3()
const origin = new Vector3()
const rotation = new Matrix4()
const yaw = new Quaternion()

/**
 * Осмотр на месте: 180° рыскания на ширину окна вокруг местной вертикали up,
 * 90° тангажа на высоту окна, тангаж зажат ±FREE_LOOK_MAX_PITCH, крена нет —
 * горизонт ровный. Мышь вправо — взгляд вправо, вверх — вверх. Меняет q на месте.
 */
export function freeLookRotate(q: Quaternion, up: Vector3, dx: number, dy: number, width: number, height: number): void {
  forward.set(0, 0, -1).applyQuaternion(q)
  const sinPitch = Math.min(1, Math.max(-1, forward.dot(up)))
  horizon.copy(forward).addScaledVector(up, -sinPitch)

  // взгляд почти вдоль вертикали (после орбиты — строго в центр тела): «вперёд» по горизонту — верх кадра
  if (horizon.lengthSq() < 1e-12) {
    cameraUp.set(0, 1, 0).applyQuaternion(q)
    horizon.copy(cameraUp).addScaledVector(up, -cameraUp.dot(up)).multiplyScalar(sinPitch < 0 ? 1 : -1)
  }
  horizon.normalize()

  horizon.applyQuaternion(yaw.setFromAxisAngle(up, (-Math.PI * dx) / width))
  const pitch = Math.min(
    FREE_LOOK_MAX_PITCH,
    Math.max(-FREE_LOOK_MAX_PITCH, Math.asin(sinPitch) - ((Math.PI / 2) * dy) / height)
  )
  look.copy(horizon).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch))

  q.setFromRotationMatrix(rotation.lookAt(origin, look, up))
}
