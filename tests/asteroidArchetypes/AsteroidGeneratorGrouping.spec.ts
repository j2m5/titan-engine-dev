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
