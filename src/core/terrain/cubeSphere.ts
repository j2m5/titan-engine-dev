import { Vector3 } from 'three'

/** Глубина статической кубосферы: 6·4³ = 384 патча (этап 3а; квадродерево 3б сделает её переменной). */
export const TERRAIN_PATCH_DEPTH = 3

/** Квадов на сторону патча (65×65 вершин) — размер из роадмапа. */
export const TERRAIN_PATCH_SEGMENTS = 64

export const CUBE_FACES = 6

/** Базисы граней: правые тройки u×v = n — треугольники патчей смотрят наружу. */
const FACE_NORMAL: readonly Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1)
]
const FACE_U: readonly Vector3[] = [
  new Vector3(0, 0, -1),
  new Vector3(0, 0, 1),
  new Vector3(1, 0, 0),
  new Vector3(1, 0, 0),
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0)
]
const FACE_V: readonly Vector3[] = [
  new Vector3(0, 1, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, -1),
  new Vector3(0, 0, 1),
  new Vector3(0, 1, 0),
  new Vector3(0, 1, 0)
]

const QUARTER_PI = Math.PI / 4

/**
 * Равноугольная развёртка (equal-angle, как в S2): tan(π/4·x) по обеим
 * координатам грани выравнивает угловой шаг сетки — у наивного normalize
 * тексели в углу грани ~2.4× мельче центра, и SSE-метрика 3б не смогла бы
 * считать ошибку патча константой уровня.
 */
export function cubeFaceDirection(face: number, s: number, t: number, out: Vector3): Vector3 {
  const su = Math.tan(QUARTER_PI * s)
  const tv = Math.tan(QUARTER_PI * t)

  return out
    .copy(FACE_NORMAL[face])
    .addScaledVector(FACE_U[face], su)
    .addScaledVector(FACE_V[face], tv)
    .normalize()
}
