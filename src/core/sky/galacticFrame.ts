import { Matrix3, Matrix4 } from 'three'
import { THREE_TO_ASTRO } from '@/core/libs/frames'

/** Наклон эклиптики к экватору J2000, рад */
export const OBLIQUITY_J2000: number = (23.4392911 * Math.PI) / 180

/**
 * ICRS → галактические (матрица A_G документации Gaia DR2, та же, что в
 * генераторе Брунетона): x — к центру Галактики, z — к северному полюсу
 */
const ICRS_TO_GALACTIC: Matrix3 = new Matrix3().set(
  -0.0548755604162154, -0.873437090234885, -0.483835015548713,
  0.494109427875584, -0.444829629960011, 0.746982244497219,
  -0.867666149019005, -0.198076373431201, 0.455983776175067
)

function eclipticToIcrs(): Matrix3 {
  const c = Math.cos(OBLIQUITY_J2000)
  const s = Math.sin(OBLIQUITY_J2000)
  return new Matrix3().set(1, 0, 0, 0, c, -s, 0, s, c)
}

/**
 * Сцена three → галактические координаты: three → эклиптика J2000 (Z-up) →
 * экватор ICRS → галактика. Эклиптика сцены совпадает с эклиптикой неба
 */
export const SCENE_TO_GALACTIC: Matrix3 = ICRS_TO_GALACTIC.clone()
  .multiply(eclipticToIcrs())
  .multiply(new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(THREE_TO_ASTRO)))
