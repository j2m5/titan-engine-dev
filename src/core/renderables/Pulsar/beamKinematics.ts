import { Vector3 } from 'three'
import { getJ2000SecondsFromJD } from '@/core/helpers/jd'

const TWO_PI = Math.PI * 2
/** Свёртка симуляционных секунд: 12 периодов — фаза не теряется, float не растёт (как у вращения камней) */
const WRAP_PERIODS = 12
/** Ближнее гашение — доля длины луча, где светит гало, а не луч */
const NEAR_FRACTION = 0.02

/** Фаза маяка, радианы в [0, 2π): симуляционное время, а не рендер-часы */
export function beamPhaseAt(jd: number, periodSeconds: number, phaseRad: number): number {
  const seconds = getJ2000SecondsFromJD(jd)
  const wrap = WRAP_PERIODS * periodSeconds
  const wrapped = seconds - Math.floor(seconds / wrap) * wrap
  const phase = (TWO_PI * wrapped) / periodSeconds + phaseRad
  return phase - Math.floor(phase / TWO_PI) * TWO_PI
}

/** Магнитная ось в кадре, где +Y — ось вращения: наклон tilt, поворот вокруг Y на фазу */
export function magneticAxisAt(phaseRad: number, tiltRad: number, target: Vector3): Vector3 {
  const s = Math.sin(tiltRad)
  return target.set(s * Math.cos(phaseRad), Math.cos(tiltRad), -s * Math.sin(phaseRad))
}

/**
 * Плотность луча в точке p (кадр узла лучей): гауссов профиль по углу к оси
 * (любого знака), квадратичный спад по длине, ближнее гашение. То же
 * выражение, что в GLSL PulsarBeamsMaterial — менять синхронно
 */
export function beamDensity(
  p: Vector3,
  axis: Vector3,
  halfAngleRad: number,
  lengthUnits: number,
  intensity: number
): number {
  const d = p.length()
  if (d <= 0 || d >= lengthUnits) return 0
  const cosA = Math.min(1, Math.abs(p.dot(axis)) / d)
  const angle = Math.acos(cosA)
  const angular = Math.exp(-((angle / halfAngleRad) ** 2))
  const radial = (1 - d / lengthUnits) ** 2
  const nearT = Math.min(1, d / (NEAR_FRACTION * lengthUnits))
  const near = nearT * nearT * (3 - 2 * nearT)
  return intensity * angular * radial * near
}
