import { Matrix3, Matrix4, Vector3 } from 'three'

function hash(value: number): number {
  const n = Math.sin(value * 91.3458) * 47453.5453
  return n - Math.floor(n)
}

export function wrapAsteroidSpinTime(seconds: number, period: number): number {
  if (!(period > 0) || !Number.isFinite(period) || !Number.isFinite(seconds)) return 0
  const wrap = 12 * period
  return seconds - Math.floor(seconds / wrap) * wrap
}

export function asteroidSpin(seed: number, period: number, time: number): Matrix3 {
  if (!(period > 0)) return new Matrix3()
  const axis = new Vector3(hash(seed + 13.13), hash(seed + 17.17), hash(seed + 19.19)).multiplyScalar(2).subScalar(1).normalize()
  const steps = Math.min(6 + Math.floor(hash(seed + 23.23) * 13), 18)
  const angle = 2 * Math.PI * (time * (steps / 12) / period + hash(seed + 29.29))
  return new Matrix3().setFromMatrix4(new Matrix4().makeRotationAxis(axis, angle))
}
