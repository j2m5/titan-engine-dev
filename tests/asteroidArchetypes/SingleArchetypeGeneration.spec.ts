import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import type { AsteroidProfileName } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { RadialDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/RadialDensityProfile'

const profiles: (AsteroidProfileName | undefined)[] = [undefined, 'stony', 'carbonaceous', 'metallic', 'icy']

describe('single-archetype generation', () => {
  it.each(profiles)('assigns every instance to the sole group with profile %s', profile => {
    const generator = new AsteroidGenerator({ thickness: 10, minScale: 0.5, maxScale: 2, profile })
    for (const seed of [0, 777, -1, 0xffffffff]) for (const count of [0, 1, 37]) {
      const ids = generator.archetypeAssignment(seed, count, 1)
      expect(Array.from(ids)).toEqual(Array<number>(count).fill(0))
    }
    const first = generator.archetypeAssignment(777, 3, 1)
    first[0] = 9
    expect(Array.from(generator.archetypeAssignment(777, 3, 1))).toEqual([0, 0, 0])
    expect(Array.from(first)).toEqual([9, 0, 0])
  })

  it.each(profiles)('preserves matrix order across one and multiple groups with profile %s', profile => {
    for (const relativeToSector of [false, true]) for (const volumetric of [false, true]) {
      const generator = new AsteroidGenerator({ thickness: 10, minScale: 0.5, maxScale: 2,
        profile, relativeToSector, volumetric, sizeExponent: 1.7 })
      const bounds = { minRadius: 105, maxRadius: 195, minAngle: -0.3, maxAngle: 0.2, minY: -4, maxY: -1 }
      generator.setDensityProfile(new RadialDensityProfile([0, 1, 0.2, 0.7], 100, 200))
      for (const count of [0, 1, 37]) {
        const flat = generator.generateMatrices(4242, count, bounds)
        expect(flat.length).toBe(count * 16)
        expect(Array.from(flat).every(Number.isFinite)).toBe(true)
        const ids = generator.archetypeAssignment(4242, count, 14)
        const grouped = generator.generateMatricesGrouped(4242, count, bounds, 14)
        expect(grouped.reduce((sum, group) => sum + group.length, 0)).toBe(flat.length)
        const offsets = new Uint32Array(14)
        const restored = new Float32Array(flat.length)
        for (let i = 0; i < count; i++) {
          const k = ids[i], offset = offsets[k]
          restored.set(grouped[k].subarray(offset, offset + 16), i * 16)
          offsets[k] += 16
        }
        expect(new Uint8Array(restored.buffer)).toEqual(new Uint8Array(flat.buffer))
        if (count === 37) expect(new Set(ids).size).toBeGreaterThan(1)
      }
    }
  })
})
