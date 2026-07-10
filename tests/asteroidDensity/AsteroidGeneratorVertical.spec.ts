import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import type { SectorBounds } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'

const bounds: SectorBounds = { minRadius: 100, maxRadius: 200, minAngle: 0, maxAngle: Math.PI / 8 }

/** Извлечь Y-компоненты позиций из упакованных матриц (translation.y = элемент 13) */
const extractY = (data: Float32Array): number[] => {
  const ys: number[] = []
  for (let i = 13; i < data.length; i += 16) ys.push(data[i])
  return ys
}

describe('AsteroidGenerator: вертикальное распределение (против «стенок»)', () => {
  const halfThickness = 5
  const generator = new AsteroidGenerator({ thickness: halfThickness * 2, minScale: 0.5, maxScale: 1.5 })

  it('камни остаются внутри толщины кольца', () => {
    const ys = extractY(generator.generateMatrices(1234, 2000, bounds))
    for (const y of ys) {
      expect(Math.abs(y)).toBeLessThanOrEqual(halfThickness)
    }
  })

  it('распределение треугольное: пик в средней плоскости, спад к краям', () => {
    // Для треугольного распределения P(|y| < h/2) = 1 − (1 − 1/2)² = 0.75
    // (у равномерного слэба было бы 0.5 — плоские грани и «стенка»)
    const ys = extractY(generator.generateMatrices(777, 8000, bounds))
    const nearMidplane = ys.filter((y) => Math.abs(y) < halfThickness / 2).length / ys.length
    expect(nearMidplane).toBeGreaterThan(0.71)
    expect(nearMidplane).toBeLessThan(0.79)

    // Симметрия относительно средней плоскости
    const mean = ys.reduce((s, y) => s + y, 0) / ys.length
    expect(Math.abs(mean)).toBeLessThan(halfThickness * 0.02)
  })

  it('детерминизм: тот же seed → та же геометрия', () => {
    const a = generator.generateMatrices(42, 500, bounds)
    const b = generator.generateMatrices(42, 500, bounds)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
