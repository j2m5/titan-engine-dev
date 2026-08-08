import { Vector3 } from 'three'

/**
 * CPU-зеркало поля потока запекания (чанк bdFlowChunk).
 *
 * ВАЖНО: менять строго синхронно с
 * src/core/renderables/BrownDwarf/BrownDwarfBakeShaders.ts.
 *
 * Поток обязан быть касательным к сфере: снос выборки не должен уводить точку
 * с единичной сферы. Обе части строятся через векторное произведение с самим
 * направлением, поэтому касательность — свойство конструкции, а не подгонки.
 */

const POLE_EPSILON = 1e-4

/**
 * Восточный вектор. На полюсах cross с осью Y вырождается в ноль, и normalize
 * дал бы NaN — там возвращается нулевой вектор, а не нормированный мусор.
 */
export function bdEast(dir: Vector3): Vector3 {
  const east = new Vector3().crossVectors(new Vector3(0, 1, 0), dir)

  return east.lengthSq() < POLE_EPSILON * POLE_EPSILON ? new Vector3(0, 0, 0) : east.normalize()
}

/** Скалярный потенциал вихрей. Зеркало обязано повторять GLSL побитово по форме, не по значению шума */
export function bdPotential(dir: Vector3, seed: number): number {
  return Math.sin(dir.x * 3.1 + seed) * Math.cos(dir.y * 2.7 - seed) * Math.sin(dir.z * 3.7 + seed * 0.5)
}

/** Градиент потенциала конечными разностями — та же схема, что в GLSL */
export function bdPotentialGradient(dir: Vector3, seed: number): Vector3 {
  const h = 1e-3
  const grad = new Vector3()

  for (const axis of ['x', 'y', 'z'] as const) {
    const plus = dir.clone()
    const minus = dir.clone()
    plus[axis] += h
    minus[axis] -= h
    grad[axis] = (bdPotential(plus, seed) - bdPotential(minus, seed)) / (2 * h)
  }

  return grad
}

/** Зональные струи плюс вихри. Обе части касательны к сфере по построению */
export function bdFlow(
  dir: Vector3,
  bandCount: number,
  jetStrength: number,
  turbulence: number,
  seed: number
): Vector3 {
  const zonal = bdEast(dir).multiplyScalar(jetStrength * Math.sin(dir.y * Math.PI * bandCount))
  const curl = new Vector3().crossVectors(dir, bdPotentialGradient(dir, seed)).multiplyScalar(turbulence)

  return zonal.add(curl)
}
