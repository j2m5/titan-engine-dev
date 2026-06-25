import { Vector3 } from 'three'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

describe('NebulaField structure', () => {
  it('a lobe raises density in its neighborhood', () => {
    const probe = new Vector3(0.5, 0, 0)
    const plain = new NebulaField(mergeNebulaParams({ seed: 3 }))
    const withLobe = new NebulaField(
      mergeNebulaParams({
        seed: 3,
        lobes: [{ center: new Vector3(0.5, 0, 0), radius: 0.3, weight: 1.5, seed: 9 }]
      })
    )
    expect(withLobe.sampleDensity(probe)).toBeGreaterThan(plain.sampleDensity(probe))
  })

  it('a cavity lowers density at its center', () => {
    const probe = new Vector3(-0.3, 0.1, 0.2)
    const plain = new NebulaField(mergeNebulaParams({ seed: 3 }))
    const withCavity = new NebulaField(
      mergeNebulaParams({
        seed: 3,
        cavities: [{ center: new Vector3(-0.3, 0.1, 0.2), radius: 0.3, strength: 1 }]
      })
    )
    expect(withCavity.sampleDensity(probe)).toBeLessThanOrEqual(plain.sampleDensity(probe))
  })

  it('dustMask is bounded in [0,1] and varies in space', () => {
    const field = new NebulaField(mergeNebulaParams())
    const a = field.dustMask(new Vector3(0.1, 0.2, 0.3))
    const b = field.dustMask(new Vector3(-0.4, 0.05, 0.6))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(1)
    expect(a).not.toBe(b)
  })
})
