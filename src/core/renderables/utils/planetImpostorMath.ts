import { Color, Vector3 } from 'three'

/**
 * Цвет и фаза точки-импостора планеты (FakePlanet).
 *
 * Цвет — из Actor.color (цвет орбит и маркеров, обычно яркий): приглушается к
 * собственной люме и нормируется к люме прежнего серого #b6b6b6 — в полной
 * фазе точка той же яркости, что до фичи, только с оттенком тела. Каналы не
 * выше 0.99: тот же bloom-guard, что у диффуза планеты.
 */
export const IMPOSTOR_REFERENCE_HEX = '#b6b6b6'
export const IMPOSTOR_MAX_CHANNEL = 0.99

const HEX_RE = /^#[0-9a-f]{6}$/i

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Линейный цвет точки из hex актора; пустой/невалидный/чёрный — опорный серый. */
export function impostorColorFromActor(hex: string, saturation: number): Color {
  const reference = new Color(IMPOSTOR_REFERENCE_HEX)
  if (!HEX_RE.test(hex)) return reference

  const source = new Color(hex)
  const l = luma(source.r, source.g, source.b)
  if (l < 1e-4) return reference

  // mix(L, c, s) люму не меняет — веса люмы в сумме 1
  const s = Math.min(Math.max(saturation, 0), 1)
  const r = l + (source.r - l) * s
  const g = l + (source.g - l) * s
  const b = l + (source.b - l) * s

  const scale = luma(reference.r, reference.g, reference.b) / l
  // потолок канала — масштаб всего цвета: оттенок сохраняется, люма чуть ниже опорной
  const peak = Math.max(r, g, b) * scale
  const cap = peak > IMPOSTOR_MAX_CHANNEL ? IMPOSTOR_MAX_CHANNEL / peak : 1

  return new Color(r * scale * cap, g * scale * cap, b * scale * cap)
}

/** Фазовый интеграл ламбертовой сферы: (sin α + (π − α)·cos α)/π, α клампится в [0, π]. */
export function lambertPhase(alpha: number): number {
  const a = Math.min(Math.max(alpha, 0), Math.PI)

  return (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI
}

const toStar = new Vector3()
const toCamera = new Vector3()

/** Фазовый угол: между направлениями тело→звезда (звезда в нуле сцены) и тело→камера. */
export function impostorPhaseAngle(body: Vector3, camera: Vector3): number {
  toStar.copy(body).negate()
  toCamera.copy(camera).sub(body)
  if (toStar.lengthSq() < 1e-18 || toCamera.lengthSq() < 1e-18) return 0

  return toStar.angleTo(toCamera)
}
