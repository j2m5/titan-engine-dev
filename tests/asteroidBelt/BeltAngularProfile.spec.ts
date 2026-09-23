import { describe, it, expect } from 'vitest'
import { buildBeltAngularProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'

const flat = { edgeSoftness: 0, gaps: [], clumps: [] }

const meanOf = (p: Float32Array): number => p.reduce((s, v) => s + v, 0) / p.length

describe('buildBeltAngularProfile', () => {
  it('без дуг (нет поля или пустой список) — null', () => {
    expect(buildBeltAngularProfile(flat)).toBeNull()
    expect(buildBeltAngularProfile({ ...flat, arcs: [] })).toBeNull()
  })

  it('среднее по обороту ровно 1 — дуги перераспределяют, а не добавляют', () => {
    const p = buildBeltAngularProfile({
      ...flat,
      arcs: [
        { at: 0.12, width: 0.08, gain: 1.6 },
        { at: 0.58, width: 0.12, gain: 1.4 }
      ]
    })!

    expect(p.length).toBe(1024)
    expect(meanOf(p)).toBeCloseTo(1, 6)
  })

  it('пик дуги = gain / среднее ненормированного профиля', () => {
    const at = 0.25
    const width = 0.05
    const gain = 2
    const bins = 1000
    const p = buildBeltAngularProfile({ ...flat, arcs: [{ at, width, gain }] }, bins)!

    // Ненормированное среднее: 1 + (gain − 1)·σ√(2π) (гауссиана на полном обороте)
    const rawMean = 1 + (gain - 1) * width * Math.sqrt(2 * Math.PI)
    expect(p[250]).toBeCloseTo(gain / rawMean, 3)
    // Напротив дуги — фон: 1 / rawMean
    expect(p[750]).toBeCloseTo(1 / rawMean, 3)
  })

  it('периодичен: дуга у 0.98 продолжается в бины у нуля', () => {
    const p = buildBeltAngularProfile({ ...flat, arcs: [{ at: 0.98, width: 0.08, gain: 1.6 }] }, 1000)!

    // В 0.02 от центра (0.25σ) профиль почти на пике — и с обеих сторон границы
    expect(p[0]).toBeGreaterThan(0.95 * p[980])
    // Бины 0 (u = 0.0005) и 959 (u = 0.9595) равноудалены от центра 0.98
    expect(p[0]).toBeCloseTo(p[959], 5)
    // На противоположной стороне (0.48) — фон
    expect(p[480]).toBeLessThan(p[0])
  })

  it('значения неотрицательны, число бинов — аргумент', () => {
    const p = buildBeltAngularProfile({ ...flat, arcs: [{ at: 0.5, width: 0.1, gain: 0 }] }, 64)!

    expect(p.length).toBe(64)
    for (const v of p) expect(v).toBeGreaterThanOrEqual(0)
    expect(meanOf(p)).toBeCloseTo(1, 6)
  })
})
