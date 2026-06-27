import { Vector3 } from 'three'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaField noise', () => {
  it('introduces spatial variation inside the proxy', () => {
    const field = new NebulaField(mergeNebulaParams({ noise: { warpStrength: 0.4 } }))
    const samples: number[] = []
    for (let i = 0; i < 40; i++)
      samples.push(field.sampleDensity(new Vector3(Math.sin(i) * 0.4, Math.cos(i) * 0.3, (i % 7) * 0.1)))
    const max = Math.max(...samples)
    const min = Math.min(...samples)
    expect(max - min).toBeGreaterThan(0.02) // real spatial structure, not a flat blob
  })

  it('is deterministic for a fixed seed', () => {
    const a = new NebulaField(mergeNebulaParams({ seed: 5 }))
    const b = new NebulaField(mergeNebulaParams({ seed: 5 }))
    const probe = new Vector3(0.2, -0.1, 0.3)
    expect(a.sampleDensity(probe)).toBe(b.sampleDensity(probe))
  })

  it('stays within [0,1]', () => {
    const field = new NebulaField(mergeNebulaParams({ noise: { contrast: 2.5 } }))
    for (let i = 0; i < 60; i++) {
      const d = field.sampleDensity(new Vector3((i % 5) * 0.3 - 0.6, (i % 3) * 0.4 - 0.4, (i % 7) * 0.2 - 0.7))
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
})
