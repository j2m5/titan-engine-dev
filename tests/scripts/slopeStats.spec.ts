import { describe, expect, it } from 'vitest'
import { slopeStatistics } from '../../scripts/lib/slopeStats'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

function makeMap(width: number, height: number, values: number[]): HeightMapData {
  return { width, height, minMeters: 0, maxMeters: 65535, data: new Uint16Array(values) }
}

describe('slopeStatistics', () => {
  it('плоская карта — все перцентили 0', () => {
    const s = slopeStatistics(makeMap(4, 2, new Array(8).fill(100)), 1000)
    expect(s.p50).toBe(0)
    expect(s.max).toBe(0)
  })

  it('перцентили монотонны и max ≥ p999 ≥ p99 ≥ p90 ≥ p50', () => {
    const row = [0, 500, 3000, 500]
    const s = slopeStatistics(makeMap(4, 2, [...row, ...row]), 1000)
    expect(s.max).toBeGreaterThanOrEqual(s.p999)
    expect(s.p999).toBeGreaterThanOrEqual(s.p99)
    expect(s.p99).toBeGreaterThanOrEqual(s.p90)
    expect(s.p90).toBeGreaterThanOrEqual(s.p50)
    expect(s.max).toBeGreaterThan(0)
  })
})
