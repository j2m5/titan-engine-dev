import { Vector3 } from 'three'

export interface CubeFaceBasis {
  /** Направление в центр грани */
  forward: Vector3
  /** Направление роста u внутри грани */
  right: Vector3
  /** Направление роста v внутри грани */
  up: Vector3
}

/**
 * Базис шести граней кубмапы в конвенции three (та же, что у CubeCamera).
 * Порядок — порядок activeCubeFace у renderer.setRenderTarget:
 * +X, -X, +Y, -Y, +Z, -Z.
 *
 * Направление тексела: normalize(forward + u * right + v * up), где
 * u, v пробегают [-1..1]. Вертикаль у граней инвертирована — это конвенция
 * кубмапы GL, а не опечатка: перепутанный знак даёт зеркальные грани и
 * разрыв рисунка по рёбрам.
 */
export const CUBE_FACE_BASIS: readonly CubeFaceBasis[] = [
  { forward: new Vector3(1, 0, 0), right: new Vector3(0, 0, -1), up: new Vector3(0, -1, 0) },
  { forward: new Vector3(-1, 0, 0), right: new Vector3(0, 0, 1), up: new Vector3(0, -1, 0) },
  { forward: new Vector3(0, 1, 0), right: new Vector3(1, 0, 0), up: new Vector3(0, 0, 1) },
  { forward: new Vector3(0, -1, 0), right: new Vector3(1, 0, 0), up: new Vector3(0, 0, -1) },
  { forward: new Vector3(0, 0, 1), right: new Vector3(1, 0, 0), up: new Vector3(0, -1, 0) },
  { forward: new Vector3(0, 0, -1), right: new Vector3(-1, 0, 0), up: new Vector3(0, -1, 0) }
]

/** Направление тексела грани по нормированным координатам u, v из [-1..1] */
export function faceUVToDirection(face: number, u: number, v: number): Vector3 {
  const basis: CubeFaceBasis = CUBE_FACE_BASIS[face]

  return new Vector3()
    .copy(basis.forward)
    .addScaledVector(basis.right, u)
    .addScaledVector(basis.up, v)
    .normalize()
}

/**
 * Обратный поиск: грань выбирается по главной оси направления (правило
 * OpenGL), u и v — проекции на базис этой грани. Написано независимо от
 * таблицы выше, чтобы round-trip был проверкой, а не тавтологией.
 */
export function directionToFaceUV(dir: Vector3): { face: number; u: number; v: number } {
  const ax: number = Math.abs(dir.x)
  const ay: number = Math.abs(dir.y)
  const az: number = Math.abs(dir.z)

  let face: number

  if (ax >= ay && ax >= az) face = dir.x > 0 ? 0 : 1
  else if (ay >= az) face = dir.y > 0 ? 2 : 3
  else face = dir.z > 0 ? 4 : 5

  const basis: CubeFaceBasis = CUBE_FACE_BASIS[face]
  const major: number = dir.dot(basis.forward)

  return {
    face,
    u: dir.dot(basis.right) / major,
    v: dir.dot(basis.up) / major
  }
}
