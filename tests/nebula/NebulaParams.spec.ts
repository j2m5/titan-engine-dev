import { Color, Vector3 } from 'three'
import { DEFAULT_NEBULA_PARAMS, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaParams', () => {
  it('exposes a valid default param set', () => {
    const p = DEFAULT_NEBULA_PARAMS
    expect(p.seed).toBeTypeOf('number')
    expect(p.shape).toBe('ellipsoid')
    expect(p.size).toBeGreaterThan(0)
    expect(p.palette.stops.length).toBeGreaterThanOrEqual(2)
    expect(p.noise.octaves).toBeGreaterThanOrEqual(1)
  })

  it('deep-merges overrides over defaults without mutating defaults', () => {
    const merged = mergeNebulaParams({ seed: 42, noise: { octaves: 6 } })
    expect(merged.seed).toBe(42)
    expect(merged.noise.octaves).toBe(6)
    // untouched fields fall back to defaults
    expect(merged.noise.lacunarity).toBe(DEFAULT_NEBULA_PARAMS.noise.lacunarity)
    expect(merged.shape).toBe(DEFAULT_NEBULA_PARAMS.shape)
    // defaults untouched
    expect(DEFAULT_NEBULA_PARAMS.seed).not.toBe(42)
  })

  it('clamps quality.resolutionScale into [0.25, 1]', () => {
    expect(mergeNebulaParams({ quality: { resolutionScale: 5 } }).quality.resolutionScale).toBe(1)
    expect(mergeNebulaParams({ quality: { resolutionScale: 0 } }).quality.resolutionScale).toBe(0.25)
  })

  it('produces independent Color/Vector3 clones per call', () => {
    const a = mergeNebulaParams()
    const b = mergeNebulaParams()
    a.palette.secondary.setRGB(1, 0, 0)
    expect(b.palette.secondary.getHex()).not.toBe(a.palette.secondary.getHex())
    expect(a.axisRatios).not.toBe(b.axisRatios)
  })

  it('clones override lobes/cavities (no aliasing) and defaults partial entries', () => {
    const lobes = [{ center: new Vector3(0.5, 0, 0), radius: 0.3 }] // missing weight/seed
    const merged = mergeNebulaParams({ lobes: lobes as never })
    // partial fields are defaulted, not NaN
    expect(merged.lobes[0].weight).toBe(1)
    expect(merged.lobes[0].seed).toBe(0)
    expect(Number.isNaN(merged.lobes[0].weight)).toBe(false)
    // the stored lobe is a clone, not the caller's object
    expect(merged.lobes[0]).not.toBe(lobes[0])
    expect(merged.lobes[0].center).not.toBe(lobes[0].center)
    merged.lobes[0].center.x = 99
    expect(lobes[0].center.x).toBe(0.5) // caller's object untouched
  })

  it('does not mutate a base passed as the second argument', () => {
    const base = mergeNebulaParams({ seed: 1, size: 100 })
    const snapshotSeed = base.seed
    const snapshotSize = base.size
    const derived = mergeNebulaParams({ size: 200 }, base)
    expect(derived.size).toBe(200)
    expect(derived.seed).toBe(1)        // inherited from base
    expect(base.size).toBe(snapshotSize) // base untouched
    expect(base.seed).toBe(snapshotSeed)
  })
})
