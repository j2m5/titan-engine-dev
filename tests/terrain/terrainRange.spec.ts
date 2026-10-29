import { describe, expect, it } from 'vitest'
import { bilinearRange, BilinearRowRanges } from '@/core/terrain/terrainRange'

describe('диапазон ограниченной области билинейного поля', () => {
  it('широкая полярная полоса исключает далёкий пик и переиспользует строки', () => {
    let calls = 0
    const sample = (u: number, v: number): number => {
      calls++
      return v < 0.01 ? 20 * v : u > 0.8 ? 1000 : 20
    }
    const rows = new BilinearRowRanges(sample, 1024, 512)
    const uv = { u0: 0.1, u1: 0.4, v0: 0, v1: 0.0001 }
    const first = rows.range(uv, { min: 0, max: 1000 })
    expect(first.max).toBeCloseTo(0.002, 8)
    const built = calls
    expect(rows.range(uv, { min: 0, max: 1000 })).toEqual(first)
    expect(calls).toBe(built)
  })

  it('индекс строк охватывает завёрнутые долготы и оба края карты', () => {
    const sample = (u: number, v: number): number => 100 * Math.sin(u * Math.PI * 2) + 50 * v
    const rows = new BilinearRowRanges(sample, 128, 64)
    for (const uv of [
      { u0: -0.2, u1: 0.2, v0: 0, v1: 0.001 },
      { u0: 0.7, u1: 1.1, v0: 0.999, v1: 1 }
    ]) {
      const result = rows.range(uv, { min: -100, max: 150 })
      for (let i = 0; i <= 100; i++) {
        // Bound the bilinear interpolation of the sine samples, not the sine between them.
        const u = uv.u0 + ((uv.u1 - uv.u0) * i) / 100
        const x = u * 128 - 0.5,
          x0 = Math.floor(x),
          f = x - x0
        for (const v of [uv.v0, uv.v1]) {
          const value = sample((x0 + 0.5) / 128, v) * (1 - f) + sample((x0 + 1.5) / 128, v) * f
          expect(value).toBeGreaterThanOrEqual(result.min)
          expect(value).toBeLessThanOrEqual(result.max)
        }
      }
    }
  })

  it('учитывает только запрошенную часть ячейки и сходится к точке', () => {
    const sample = (u: number, v: number): number => 2 + 3 * u - 4 * v + 5 * u * v
    const range = bilinearRange(
      sample,
      1,
      1,
      { u0: 0.1, u1: 0.3, v0: 0.2, v1: 0.4 },
      { min: -10, max: 10 },
      { min: 0, max: 0 }
    )
    expect(range.min).toBeCloseTo(0.9, 9)
    expect(range.max).toBeCloseTo(2.4, 9)
    const point = bilinearRange(
      sample,
      1,
      1,
      { u0: 0.2, u1: 0.2, v0: 0.3, v1: 0.3 },
      { min: -10, max: 10 },
      { min: 0, max: 0 }
    )
    expect(point.min).toBeCloseTo(1.7, 9)
    expect(point.max).toBeCloseTo(1.7, 9)
  })

  it('не пропускает вершину между концами и через шов долготы', () => {
    const sample = (u: number): number => {
      const d = Math.abs(u - Math.floor(u) - 0.125)
      return 100 * Math.max(0, 1 - Math.min(d, 1 - d) * 4)
    }
    const range = bilinearRange(
      sample,
      4,
      2,
      { u0: -0.1, u1: 0.2, v0: 0, v1: 1 },
      { min: 0, max: 100 },
      { min: 0, max: 0 }
    )
    expect(range.min).toBeCloseTo(10, 8)
    expect(range.max).toBeCloseTo(100, 8)
  })

  it('большая область использует глобальную границу с ограниченной работой', () => {
    let samples = 0
    const range = bilinearRange(
      () => {
        samples++
        return 0
      },
      8192,
      4096,
      { u0: 0, u1: 1, v0: 0, v1: 1 },
      { min: -200, max: 900 },
      { min: 0, max: 0 }
    )
    expect(range.min).toBeLessThanOrEqual(-200)
    expect(range.max).toBeGreaterThanOrEqual(900)
    expect(samples).toBeLessThanOrEqual(256)
  })
})
