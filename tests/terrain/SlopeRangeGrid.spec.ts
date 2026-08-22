import { describe, expect, it } from 'vitest'
import { SLOPE_RANGE, SLOPE_RANGE_GRID, isValidSlopeRange, recommendSlopeRange } from '@/core/terrain/slopeMapFormat'

describe('slopeMapFormat: сетка диапазонов', () => {
  it('сетка степеней двойки, дефолт SLOPE_RANGE в ней', () => {
    expect(SLOPE_RANGE_GRID).toEqual([0.25, 0.5, 1, 2, 4])
    expect(SLOPE_RANGE_GRID).toContain(SLOPE_RANGE)
  })

  it('рекомендация — наименьшее значение сетки ≥ p99.9, потолок 4', () => {
    expect(recommendSlopeRange(0.3)).toBe(0.5)
    expect(recommendSlopeRange(0.5)).toBe(0.5)
    expect(recommendSlopeRange(0.51)).toBe(1)
    expect(recommendSlopeRange(0.1)).toBe(0.25)
    expect(recommendSlopeRange(3)).toBe(4)
    expect(recommendSlopeRange(49)).toBe(4)
  })

  it('isValidSlopeRange принимает только значения сетки', () => {
    expect(isValidSlopeRange(0.5)).toBe(true)
    expect(isValidSlopeRange(0.3)).toBe(false)
    expect(isValidSlopeRange('0.5')).toBe(false)
    expect(isValidSlopeRange(undefined)).toBe(false)
  })
})
