import { describe, expect, it } from 'vitest'
import { assertProceduralBodyKnobs, proceduralLuminance } from '../../scripts/lib/proceduralHeightInput'

describe('proceduralLuminance', () => {
  it('детерминирован, в [0,1], полюса без NaN, шов долготы непрерывен', () => {
    const w = 64, h = 32
    const a = proceduralLuminance(93, w, h)
    expect(a).toEqual(proceduralLuminance(93, w, h))
    let min = 1, max = 0
    for (const v of a) { expect(Number.isFinite(v)).toBe(true); min = Math.min(min, v); max = Math.max(max, v) }
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThanOrEqual(1)
    // шов: колонка 0 и колонка w-1 близки (непрерывность 3D-поля)
    for (let y = 0; y < h; y++) expect(Math.abs(a[y * w] - a[y * w + w - 1])).toBeLessThan(0.2)
  })

  it('два актора с разными сидами дают разные растры', () => {
    const a = proceduralLuminance(93, 32, 16)
    const b = proceduralLuminance(94, 32, 16)
    let diff = 0
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
    expect(diff / a.length).toBeGreaterThan(0.05)
  })
})

describe('assertProceduralBodyKnobs', () => {
  it('бросает на smoothSigmaTexels — ручка elevation, procedural-ветка её тихо игнорирует', () => {
    expect(() => assertProceduralBodyKnobs({ name: 'korriban1', smoothSigmaTexels: 1.5 })).toThrow(/smoothSigmaTexels/)
  })

  it('бросает на highPassKm', () => {
    expect(() => assertProceduralBodyKnobs({ name: 'korriban1', highPassKm: 300 })).toThrow(/highPassKm/)
  })

  it('бросает на peakPercentile', () => {
    expect(() => assertProceduralBodyKnobs({ name: 'korriban1', peakPercentile: 0.999 })).toThrow(/peakPercentile/)
  })

  it('не бросает на чистой записи; peakMeters разрешён — процедурная ветка его читает (elevationPeakMeters)', () => {
    expect(() => assertProceduralBodyKnobs({ name: 'korriban1', peakMeters: 5000 })).not.toThrow()
    expect(() => assertProceduralBodyKnobs({ name: 'korriban1' })).not.toThrow()
  })
})
