import { Quaternion, Vector3 } from 'three'

/**
 * Кватернион конвертации из астрономической системы координат (Z-up, эклиптика J2000)
 * в систему координат Three.js (Y-up).
 *
 * Это поворот на -90° вокруг оси X:
 * (x, y, z)_astro → (x, z, -y)_three
 *
 * Детерминант = +1 (собственное вращение), сохраняет правую систему координат.
 * CCW орбиты в астрономическом XY → CCW в Three.js XZ (при взгляде с +Y).
 */
export const ASTRO_TO_THREE = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)

export const THREE_TO_ASTRO = ASTRO_TO_THREE.clone().invert()
