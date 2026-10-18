import { Color, Vector3 } from 'three'
import { makeDefaultNebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { nebulaParamsFromData, NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { makeNebulaParams } from '@/core/renderables/Nebula/presets'

describe('independent nebula gas and dust controls', () => {
  it('defaults gas absorption and independent dust structure', () => {
    const p = makeDefaultNebulaParams()
    expect(p.gas).toEqual({ absorption: 1 })
    expect(p.dust).toMatchObject({ seed: null, frequency: 0.9, contrast: 1, strength: 0.6, threshold: 0.55 })
  })

  it('merges and clones gas and dust without aliasing bases or overrides', () => {
    const base = mergeNebulaParams({ gas: { absorption: 0.7 }, dust: { seed: 23, frequency: 2 } })
    const color = new Color('#abcdef')
    const derived = mergeNebulaParams({ dust: { contrast: 3, color } }, base)
    expect(derived.gas.absorption).toBe(0.7)
    expect(derived.dust).toMatchObject({ seed: 23, frequency: 2, contrast: 3 })
    derived.gas.absorption = 0
    derived.dust.color.set('#000000')
    expect(base.gas.absorption).toBe(0.7)
    expect(base.dust.contrast).toBe(1)
    expect(color.getHex()).toBe(0xabcdef)
  })

  it('clamps finite controls and rounds dust seeds', () => {
    const low = mergeNebulaParams({ gas: { absorption: -4 }, dust: { strength: -2, threshold: -1, frequency: 0, contrast: 0, seed: 3.6 } })
    expect(low.gas.absorption).toBe(0)
    expect(low.dust).toMatchObject({ strength: 0, threshold: 0, frequency: 0.01, contrast: 0.1, seed: 4 })
    const high = mergeNebulaParams({ dust: { threshold: 4, frequency: 99, contrast: 99 } })
    expect(high.dust).toMatchObject({ threshold: 1, frequency: 32, contrast: 8 })
  })

  it.each([NaN, Infinity, -Infinity])('default-fills non-finite medium controls (%s)', (invalid) => {
    const p = mergeNebulaParams({ gas: { absorption: invalid }, dust: { strength: invalid, threshold: invalid, frequency: invalid, contrast: invalid, seed: invalid } })
    expect(p.gas.absorption).toBe(1)
    expect(p.dust).toMatchObject({ strength: 0.6, threshold: 0.55, frequency: 0.9, contrast: 1, seed: null })
  })

  it('accepts JSON roundtripped gas and dust fields over a preset', () => {
    const data: NebulaRenderingData = { preset: 'dark', gas: { absorption: 0.2 }, dust: { seed: 17, frequency: 2.3, contrast: 4, color: '#aabbcc' } }
    const p = nebulaParamsFromData(JSON.parse(JSON.stringify(data)))
    expect(p.gas.absorption).toBe(0.2)
    expect(p.dust).toMatchObject({ seed: 17, frequency: 2.3, contrast: 4, strength: 0.9, threshold: 0.4 })
    expect(p.dust.color.getHex()).toBe(0xaabbcc)
    expect(nebulaParamsFromData({ dust: { seed: null } }).dust.seed).toBeNull()
  })

  it('makes the dark preset dust-only', () => {
    const p = makeNebulaParams('dark')
    expect(p.density).toBe(0)
    expect(p.palette.emissiveIntensity).toBe(0)
    expect(p.dust.strength).toBe(0.9)
    expect(p.dust.threshold).toBe(0.4)
  })
})

describe('CPU independent dust density', () => {
  const probes = Array.from({ length: 25 }, (_, i) => new Vector3((i % 5 - 2) * 0.16, (Math.floor(i / 5) - 2) * 0.16, 0.13))

  it('keeps dust bounded and spatially independent from gas controls', () => {
    const base = mergeNebulaParams({ seed: 3, density: 0, dust: { threshold: 0.2 } })
    const field = new NebulaField(base)
    const changed = new NebulaField(mergeNebulaParams({ noise: { frequency: 19, contrast: 5, ridged: 1 }, lobes: [{ weight: 9 }] }, base))
    const values = probes.map((p) => field.sampleDustDensity(p))
    expect(values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true)
    expect(Math.max(...values)).toBeGreaterThan(0)
    expect(new Set(values).size).toBeGreaterThan(1)
    expect(probes.map((p) => changed.sampleDustDensity(p))).toEqual(values)
  })

  it('changes dust seed and frequency without changing gas', () => {
    const base = mergeNebulaParams({ seed: 3 })
    const field = new NebulaField(base)
    for (const dust of [{ seed: 42 }, { frequency: 6 }, { threshold: 0.1 }, { contrast: 3 }]) {
      const changed = new NebulaField(mergeNebulaParams({ dust }, base))
      expect(probes.map((p) => changed.sampleDensity(p))).toEqual(probes.map((p) => field.sampleDensity(p)))
      expect(probes.map((p) => changed.sampleDustDensity(p))).not.toEqual(probes.map((p) => field.sampleDustDensity(p)))
    }
  })

  it('inherits global seed when null and uses explicit seeds independently', () => {
    const inherited = new NebulaField(mergeNebulaParams({ seed: 12 }))
    const explicit = new NebulaField(mergeNebulaParams({ seed: 99, dust: { seed: 12 } }))
    expect(probes.map((p) => inherited.dustMask(p))).toEqual(probes.map((p) => explicit.dustMask(p)))
  })

  it('shares the warped envelope and cavities, with threshold one exactly empty', () => {
    const base = mergeNebulaParams({ dust: { threshold: 0.1 }, noise: { boundaryWarp: 0.3 } })
    const field = new NebulaField(base)
    expect(field.sampleDustDensity(new Vector3(4, 0, 0))).toBe(0)
    for (const p of probes) expect(field.sampleDustDensity(p)).toBeLessThanOrEqual(field.boundaryAt(p))
    const center = new Vector3(0.1, 0.2, 0.1)
    const carved = new NebulaField(mergeNebulaParams({ cavities: [{ center, radius: 0.3, strength: 1 }] }, base))
    expect(carved.sampleDustDensity(center)).toBe(0)
    const empty = new NebulaField(mergeNebulaParams({ dust: { threshold: 1 } }, base))
    expect(probes.map((p) => empty.sampleDustDensity(p))).toEqual(probes.map(() => 0))
  })
})
