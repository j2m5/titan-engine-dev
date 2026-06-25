import { fbm3, hash3, valueNoise3 } from '@/core/renderables/Nebula/fields/valueNoise'

describe('valueNoise', () => {
  it('hash3 is deterministic and within [0,1)', () => {
    const a = hash3(1, 2, 3, 99)
    const b = hash3(1, 2, 3, 99)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
    expect(hash3(1, 2, 3, 100)).not.toBe(a) // seed changes output
  })

  it('valueNoise3 is continuous and bounded in [-1,1]', () => {
    for (let i = 0; i < 50; i++) {
      const n = valueNoise3(i * 0.37, i * 0.11, i * 0.93, 7)
      expect(n).toBeGreaterThanOrEqual(-1.0001)
      expect(n).toBeLessThanOrEqual(1.0001)
    }
    // small steps -> small changes (continuity)
    const n0 = valueNoise3(3.0, 1.0, 2.0, 7)
    const n1 = valueNoise3(3.001, 1.0, 2.0, 7)
    expect(Math.abs(n1 - n0)).toBeLessThan(0.05)
  })

  it('fbm3 adds detail without exploding magnitude', () => {
    const v = fbm3({ x: 0.5, y: 0.2, z: 0.9 }, 7, 5, 2.0, 0.5)
    expect(Number.isFinite(v)).toBe(true)
    expect(Math.abs(v)).toBeLessThan(2)
    // determinism
    expect(fbm3({ x: 0.5, y: 0.2, z: 0.9 }, 7, 5, 2.0, 0.5)).toBe(v)
  })
})
