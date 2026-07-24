import {
  AsteroidGenerator,
  archetypeForInstance
} from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import type { SectorBounds } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'

const bounds: SectorBounds = { minRadius: 100, maxRadius: 200, minAngle: 0, maxAngle: Math.PI / 8 }

describe('AsteroidGenerator: раскладка по архетипам и группированные матрицы', () => {
  const generator = new AsteroidGenerator({ thickness: 10, minScale: 0.5, maxScale: 1.5 })

  it('раскладка детерминирована и грубо равномерна (K=14, 8000 инстансов, χ²-грубо ±30%)', () => {
    const seed = 777
    const count = 8000
    const archetypeCount = 14

    const counts = new Array<number>(archetypeCount).fill(0)
    for (let i = 0; i < count; i++) {
      const k = archetypeForInstance(seed, i, archetypeCount)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(archetypeCount)
      counts[k]++
    }

    const expected = count / archetypeCount
    for (const c of counts) {
      expect(c).toBeGreaterThan(expected * 0.7)
      expect(c).toBeLessThan(expected * 1.3)
    }

    // Детерминизм: повторный проход даёт те же номера
    for (let i = 0; i < count; i++) {
      expect(archetypeForInstance(seed, i, archetypeCount)).toBe(archetypeForInstance(seed, i, archetypeCount))
    }
  })

  it('НЕЗАВИСИМОСТЬ ОТ RNG: восстановленный по группам порядок совпадает побитово с generateMatrices', () => {
    const seed = 4242
    const count = 3000
    const archetypeCount = 14

    const flat = generator.generateMatrices(seed, count, bounds)
    const grouped = generator.generateMatricesGrouped(seed, count, bounds, archetypeCount)

    // Сумма длин групп = count * 16
    const totalLength = grouped.reduce((sum, g) => sum + g.length, 0)
    expect(totalLength).toBe(count * 16)

    // Бегущие офсеты внутри каждой группы, воспроизводим порядок вставки по индексу i
    const runningOffsets = new Array<number>(archetypeCount).fill(0)
    for (let i = 0; i < count; i++) {
      const k = archetypeForInstance(seed, i, archetypeCount)
      const offset = runningOffsets[k]
      runningOffsets[k] += 16

      const expectedMatrix = Array.from(flat.slice(i * 16, i * 16 + 16))
      const actualMatrix = Array.from(grouped[k].slice(offset, offset + 16))
      expect(actualMatrix).toEqual(expectedMatrix)
    }
  })

  it('сумма длин групп = count * 16 (несколько count/K комбинаций)', () => {
    const seed = 99
    for (const [count, archetypeCount] of [
      [500, 1],
      [1234, 5],
      [8000, 14]
    ]) {
      const grouped = generator.generateMatricesGrouped(seed, count, bounds, archetypeCount)
      expect(grouped.length).toBe(archetypeCount)
      const totalLength = grouped.reduce((sum, g) => sum + g.length, 0)
      expect(totalLength).toBe(count * 16)
    }
  })

  it('детерминизм: повторный вызов generateMatricesGrouped даёт побитово те же группы', () => {
    const seed = 555
    const count = 1500
    const archetypeCount = 14

    const a = generator.generateMatricesGrouped(seed, count, bounds, archetypeCount)
    const b = generator.generateMatricesGrouped(seed, count, bounds, archetypeCount)

    expect(a.length).toBe(b.length)
    for (let k = 0; k < archetypeCount; k++) {
      expect(Array.from(a[k])).toEqual(Array.from(b[k]))
    }
  })

  it('generateMatrices остаётся частным случаем generateMatricesGrouped(..., 1)[0] — побитовое совпадение', () => {
    const seed = 31337
    const count = 640

    const direct = generator.generateMatrices(seed, count, bounds)
    const viaGrouped = generator.generateMatricesGrouped(seed, count, bounds, 1)[0]

    expect(Array.from(viaGrouped)).toEqual(Array.from(direct))
  })
})

describe('AsteroidGenerator: неравномерный (пер-осевой) масштаб инстансов', () => {
  const minScale = 0.5
  const maxScale = 1.5
  const generator = new AsteroidGenerator({ thickness: 10, minScale, maxScale })

  /**
   * Норма колонки column-major 4×4 матрицы (0-based индекс колонки: 0,1,2 —
   * X/Y/Z оси ротационной части). Поскольку сама ротация ортонормирована,
   * норма колонки после composeMatrix равна фактору масштаба этой оси
   * (sx, sy или sz) — ровно то, что нужно проверить.
   */
  const columnNorm = (data: Float32Array, matrixOffset: number, column: 0 | 1 | 2): number => {
    const base = matrixOffset + column * 4
    const x = data[base]
    const y = data[base + 1]
    const z = data[base + 2]
    return Math.sqrt(x * x + y * y + z * z)
  }

  it('анизотропия реально есть: нормы трёх колонок у большинства матриц попарно различаются', () => {
    const seed = 2024
    const count = 2000
    const flat = generator.generateMatrices(seed, count, bounds)

    // Порог 0.05% относительной разницы — на четыре порядка выше float32-шума
    // ортонормированной ротации (~1e-7, замерено на uniform-scale случае), но
    // достаточно мал, чтобы редкие статистические почти-совпадения трёх
    // независимых draw'ов sx,sy,sz из [0.8, 1.25] (ожидаемо у <1% инстансов)
    // не портили тест.
    const relDiffThreshold = 0.0005
    let anisotropicCount = 0
    for (let i = 0; i < count; i++) {
      const offset = i * 16
      const nx = columnNorm(flat, offset, 0)
      const ny = columnNorm(flat, offset, 1)
      const nz = columnNorm(flat, offset, 2)
      const mean = (nx + ny + nz) / 3
      const pairwiseDistinct =
        Math.abs(nx - ny) / mean > relDiffThreshold &&
        Math.abs(ny - nz) / mean > relDiffThreshold &&
        Math.abs(nx - nz) / mean > relDiffThreshold
      if (pairwiseDistinct) anisotropicCount++
    }

    // Подавляющее большинство инстансов должно иметь три различные оси масштаба.
    expect(anisotropicCount).toBeGreaterThan(count * 0.95)
  })

  it('все нормы колонок лежат в [minScale·0.8, maxScale·1.25]', () => {
    const seed = 2025
    const count = 2000
    const flat = generator.generateMatrices(seed, count, bounds)

    const lowerBound = minScale * 0.8
    const upperBound = maxScale * 1.25

    for (let i = 0; i < count; i++) {
      const offset = i * 16
      for (const column of [0, 1, 2] as const) {
        const norm = columnNorm(flat, offset, column)
        expect(norm).toBeGreaterThanOrEqual(lowerBound - 1e-9)
        expect(norm).toBeLessThanOrEqual(upperBound + 1e-9)
      }
    }
  })

  it('КОНТРАКТ ДИАПАЗОНА: анизотропия одной матрицы капнута — max/min норм колонок ≤ 1.25/0.8 (шейдер берёт нормали через mat3(instanceMatrix) без inverse-transpose, большой перекос исказит освещение)', () => {
    const seed = 2026
    const count = 2000
    const flat = generator.generateMatrices(seed, count, bounds)

    const eps = 1e-6
    const cap = 1.25 / 0.8

    for (let i = 0; i < count; i++) {
      const offset = i * 16
      const norms = [columnNorm(flat, offset, 0), columnNorm(flat, offset, 1), columnNorm(flat, offset, 2)]
      const ratio = Math.max(...norms) / Math.min(...norms)
      expect(ratio).toBeLessThanOrEqual(cap + eps)
    }
  })

  it('детерминизм: тот же seed → та же анизотропия (побитовое совпадение матриц)', () => {
    const seed = 2027
    const count = 1000

    const a = generator.generateMatrices(seed, count, bounds)
    const b = generator.generateMatrices(seed, count, bounds)

    expect(Array.from(a)).toEqual(Array.from(b))
  })
})
