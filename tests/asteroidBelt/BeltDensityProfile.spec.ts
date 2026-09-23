import { describe, it, expect } from 'vitest'
import { buildBeltDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'

const flat = { edgeSoftness: 0, gaps: [], clumps: [] }

describe('buildBeltDensityProfile', () => {
  it('без структуры — единица везде', () => {
    expect([...buildBeltDensityProfile(flat, 8)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('мягкие края: ровно 0 на границах, 1 в середине', () => {
    const p = buildBeltDensityProfile({ ...flat, edgeSoftness: 0.1 }, 1000)

    expect(p[0]).toBe(0)
    expect(p[999]).toBe(0)
    expect(p[500]).toBe(1)
    expect(p[50]).toBeGreaterThan(0)
    expect(p[50]).toBeLessThan(1)
  })

  it('щель: провал глубиной depth в центре, вне ±3σ — единица', () => {
    const p = buildBeltDensityProfile({ ...flat, gaps: [{ at: 0.5, width: 0.02, depth: 0.85 }] }, 1000)

    expect(p[500]).toBeCloseTo(0.15, 2)
    expect(p[400]).toBeCloseTo(1, 3)
  })

  it('сгущение: подъём gain в центре, интеграл больше ширины', () => {
    const p = buildBeltDensityProfile({ ...flat, clumps: [{ at: 0.3, width: 0.05, gain: 1.6 }] }, 1000)
    const mean: number = p.reduce((s, v) => s + v, 0) / p.length

    expect(p[300]).toBeCloseTo(1.6, 2)
    expect(mean).toBeGreaterThan(1)
  })

  it('значения неотрицательны при любой комбинации', () => {
    const p = buildBeltDensityProfile(
      {
        edgeSoftness: 0.08,
        gaps: [
          { at: 0.35, width: 0.04, depth: 0.85 },
          { at: 0.62, width: 0.025, depth: 0.7 }
        ],
        clumps: [
          { at: 0.2, width: 0.06, gain: 1.6 },
          { at: 0.8, width: 0.1, gain: 1.4 }
        ]
      },
      1024
    )

    for (const v of p) expect(v).toBeGreaterThanOrEqual(0)
  })
})
