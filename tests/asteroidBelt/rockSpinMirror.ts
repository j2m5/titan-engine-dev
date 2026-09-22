/**
 * CPU-зеркало вращения камня (см. GLSL-ветку `if (uSpinPeriod > 0.0)` в
 * вершиннике InstancedAsteroidShaderTemplate). Ось и хеш периода — та же
 * семья `hashSurface11(shapeSeed + offset)`, что и остальные пер-инстансные
 * хеши шаблона (vTintSeed/vDomainOffset/vTriOffset); shapeSeed сам по себе —
 * не варьинг, а значение из hash13(instanceMatrix[3].xyz), посчитанное в
 * вершиннике один раз на инстанс.
 */

export type Vec3 = [number, number, number]

/** Зеркало float→float хеша чанка Noise.ts: fract(sin(x·91.3458)·47453.5453) */
export function hashSurface11(x: number): number {
  const s = Math.sin(x * 91.3458) * 47453.5453
  return s - Math.floor(s)
}

/** Единичная ось вращения из трёх декоррелированных хешей shapeSeed, отображённых в [-1, 1] */
export function spinAxis(shapeSeed: number): Vec3 {
  const raw: Vec3 = [
    hashSurface11(shapeSeed + 13.13) * 2 - 1,
    hashSurface11(shapeSeed + 17.17) * 2 - 1,
    hashSurface11(shapeSeed + 19.19) * 2 - 1
  ]
  const len = Math.hypot(raw[0], raw[1], raw[2])
  return [raw[0] / len, raw[1] / len, raw[2] / len]
}

/** Хеш периода инстанса ([0, 1)) — период = uSpinPeriod · (0.5 + hash) */
export function spinPeriodHash(shapeSeed: number): number {
  return hashSurface11(shapeSeed + 23.23)
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Поворот Родригеса вектора v вокруг единичной оси axis на угол angle (рад) */
export function rodrigues(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const d = dot3(axis, v)
  const c = cross3(axis, v)

  return [
    v[0] * cosA + c[0] * sinA + axis[0] * d * (1 - cosA),
    v[1] * cosA + c[1] * sinA + axis[1] * d * (1 - cosA),
    v[2] * cosA + c[2] * sinA + axis[2] * d * (1 - cosA)
  ]
}

/**
 * Полное зеркало ветки шейдера: период инстанса = spinPeriodHours · (0.5 +
 * hash), угол = 2π·t/period, поворот shapedPos/shapedNormal вокруг spinAxis.
 * uSpinPeriod <= 0 — вызывающий обязан не вызывать (в шейдере — гейт if).
 */
export function rockSpin(v: Vec3, shapeSeed: number, spinPeriodSeconds: number, t: number): Vec3 {
  const axis = spinAxis(shapeSeed)
  const period = spinPeriodSeconds * (0.5 + spinPeriodHash(shapeSeed))
  const angle = (2 * Math.PI * t) / period

  return rodrigues(v, axis, angle)
}
