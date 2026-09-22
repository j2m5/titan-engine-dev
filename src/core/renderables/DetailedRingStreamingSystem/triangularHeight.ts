import type { SeededRandom } from './SeededRandom'

/**
 * Высота по треугольному распределению (сумма двух uniform из rng): пик в
 * средней плоскости, линейный спад к краям. Общая для камней стримера
 * (AsteroidGenerator) и точек дальнего слоя (BeltPointLayer) — вынесена сюда,
 * чтобы оба места не могли разойтись в формуле.
 *
 * Тратит ровно два вызова rng.next() — порядок и число вызовов пин RNG-потока
 * генератора камней (см. AsteroidGenerator.generateMatricesGrouped).
 */
export function triangularHeight(rng: SeededRandom, halfThickness: number): number {
  return (rng.next() + rng.next() - 1) * halfThickness
}
