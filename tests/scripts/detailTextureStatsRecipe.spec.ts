import { describe, expect, it } from 'vitest'
import { clampedMean } from '../../scripts/lib/detailTextureStats'

describe('clampedMean: среднее с учётом клампа шейдера', () => {
  it('без хвоста выше 2·mean совпадает с обычным средним', () => {
    expect(clampedMean([0.2, 0.3, 0.4])).toBeCloseTo(0.3, 9)
  })

  it('с ярким хвостом — ниже обычного среднего, и mean(min(2m, v)) = m', () => {
    const v = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 5]
    const m = clampedMean(v)
    expect(m).toBeLessThan(0.59)
    const check = v.reduce((s, x) => s + Math.min(2 * m, x), 0) / v.length
    expect(check).toBeCloseTo(m, 6)
  })
})
