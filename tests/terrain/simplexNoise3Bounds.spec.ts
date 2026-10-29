import { describe, expect, it } from 'vitest'
import { snoiseGrad3 } from '@/core/terrain/simplexNoise3'
import { simplexNoise3Bounds } from '@/core/terrain/simplexNoise3Bounds'

const noise = (x: number, y: number, z: number): number => snoiseGrad3(x, y, z, { value: 0, dx: 0, dy: 0, dz: 0 }).value

describe('simplex noise: диапазон всех веток внутри шара', () => {
  it.each([
    [0.17, -0.42, 1.23, 0.003],
    [0.3, 0.3, 0, 0.00001],
    [0.1, 0.1, 0.1, 1e-8],
    [-1, -1, -1, 0.02],
    [0, 0, 0, 0.1],
    [2.1, -0.8, 0.3, 0.5]
  ])('включает центр и точки шара (%s,%s,%s), radius=%s', (x, y, z, radius) => {
    const range = simplexNoise3Bounds(x, y, z, radius, { min: 0, max: 0 })
    const check = (dx: number, dy: number, dz: number): void => {
      const value = noise(x + dx, y + dy, z + dz)
      expect(value).toBeGreaterThanOrEqual(range.min)
      expect(value).toBeLessThanOrEqual(range.max)
    }
    check(0, 0, 0)
    for (let i = 0; i < 250; i++) {
      const sy = 1 - (2 * (i + 0.5)) / 250,
        r = Math.sqrt(1 - sy * sy),
        a = i * 2.399963
      check(radius * r * Math.cos(a), radius * sy, radius * r * Math.sin(a))
    }
  })

  it('тройное равенство не теряется среди шести обычных порядков', () => {
    const range = simplexNoise3Bounds(0.1, 0.1, 0.1, 1e-9, { min: 0, max: 0 })
    expect(range.min).toBeLessThan(-0.5717)
    expect(range.max).toBeGreaterThan(-0.3649)
  })

  it('внутри одной ветки диапазон сходится к значению при уменьшении шара', () => {
    const range = simplexNoise3Bounds(0.173, -0.421, 1.231, 1e-9, { min: 0, max: 0 })
    expect(range.max - range.min).toBeLessThan(1e-6)
    expect(range.min).toBeLessThanOrEqual(noise(0.173, -0.421, 1.231))
    expect(range.max).toBeGreaterThanOrEqual(noise(0.173, -0.421, 1.231))
  })
})
