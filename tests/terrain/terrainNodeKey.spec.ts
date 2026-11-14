import { describe, expect, it } from 'vitest'
import { nodeKeyOf } from '@/core/terrain/terrainQuadtreeSelect'

describe('terrain node keys for close terrain', () => {
  it('keeps coordinates above 255 distinct from neighboring coordinates and levels', () => {
    const addresses = [
      [0, 9, 0, 256],
      [0, 9, 1, 0],
      [0, 9, 256, 0],
      [0, 9, 0, 0],
      [0, 10, 512, 0],
      [0, 10, 0, 512],
      [0, 10, 2, 0],
      [0, 10, 0, 0]
    ]
    const keys = addresses.map(([face, level, i, j]) => nodeKeyOf(face, level, i, j))
    expect(new Set(keys).size).toBe(addresses.length)
  })

  it('preserves all faces and levels at coordinate bit boundaries in positive integer keys', () => {
    const keys = new Set<number>()
    let count = 0
    for (let level = 1; level <= 10; level++) {
      const limit = 2 ** level
      const coordinates = [
        ...new Set([
          0,
          1,
          limit - 1,
          ...Array.from({ length: level }, (_, bit) => 2 ** bit - 1),
          ...Array.from({ length: level }, (_, bit) => 2 ** bit)
        ])
      ]
      for (let face = 0; face < 6; face++) {
        for (const i of coordinates)
          for (const j of coordinates) {
            const key = nodeKeyOf(face, level, i, j)
            expect(Number.isInteger(key) && key >= 0 && key < 2 ** 30).toBe(true)
            keys.add(key)
            count++
          }
      }
    }
    expect(keys.size).toBe(count)
  })
})
