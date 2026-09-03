/**
 * CPU-зеркало силуэта билборда L1 (BillboardAsteroidMaterial): проекция
 * эллипсоида инстанса на экран и гармоники края. Менять строго синхронно с GLSL.
 */

/** Амплитуда гармоник края в долях радиуса (зеркало константы шейдера) */
export const SILHOUETTE_EDGE_AMP = 0.12

/**
 * Эллипс проекции по ковариации 2×2 [[a, b], [b, c]] (= верхний-левый блок
 * A·Aᵀ, где A — матрица эллипсоида инстанса во view): угол большой оси и
 * полуоси как корни собственных значений.
 */
export function ellipseFromCovariance(a: number, b: number, c: number): { theta: number; ra: number; rb: number } {
  const theta = 0.5 * Math.atan2(2 * b, a - c)
  const mean = (a + c) * 0.5
  const dev = Math.sqrt(((a - c) * (a - c)) * 0.25 + b * b)
  return { theta, ra: Math.sqrt(Math.max(mean + dev, 0)), rb: Math.sqrt(Math.max(mean - dev, 1e-8)) }
}

/** Радиус силуэта в долях эллипса по углу φ: две плавные гармоники с фазами от сида */
export function silhouetteRadius(phi: number, seed: number): number {
  const p1 = seed * 6.2831853
  const p2 = seed * 12.566371 + 1.7
  const h2 = 0.5 + 0.5 * Math.sin(2 * phi + p1)
  const h3 = 0.5 + 0.5 * Math.sin(3 * phi + p2)
  return 1 - SILHOUETTE_EDGE_AMP * (0.6 * h2 + 0.4 * h3)
}
