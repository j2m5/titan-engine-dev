import { describe, expect, it } from 'vitest'
import { BedrockSlope } from '@/core/terrain/bedrockSlope'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'

const width = 64,
  height = 32
const data = Uint16Array.from({ length: width * height }, (_, i) => (i * 13711 + (i % width) ** 2 * 311) % 65536)
const map = new TerrainHeightField({ width, height, data, minMeters: -100000, maxMeters: 100000 }, 3390, {
  ...MIDBAND_DEFAULTS,
  midbandStrength: 0
})
const slope = new BedrockSlope((u, v) => map.sampleMeters(u, v), width, height, 3390000, { min: -100000, max: 100000 })

describe('bedrock DEM slope intervals', () => {
  it('contains slope samples across DEM knots, the longitude seam, and polar span clamping', () => {
    for (const u of [-0.001, 0.113, 0.499, 0.999]) {
      for (const v of [0.0001, 0.01, 0.2, 0.5, 0.8, 0.999]) {
        for (const size of [1e-6, 0.004, 0.04]) {
          const uv = { u0: u - size, u1: u + size, v0: Math.max(0, v - size), v1: Math.min(1, v + size) }
          const a = Math.sin(Math.PI * uv.v0),
            b = Math.sin(Math.PI * uv.v1)
          const bound = slope.range(uv, Math.min(a, b), uv.v0 <= 0.5 && uv.v1 >= 0.5 ? 1 : Math.max(a, b))
          for (let y = 0; y <= 4; y++)
            for (let x = 0; x <= 4; x++) {
              const u = uv.u0 + ((uv.u1 - uv.u0) * x) / 4,
                v = uv.v0 + ((uv.v1 - uv.v0) * y) / 4
              const value = slope.sample(u, v, Math.sin(Math.PI * v))
              expect(value).toBeGreaterThanOrEqual(bound.min)
              expect(value).toBeLessThanOrEqual(bound.max)
            }
        }
      }
    }
  })

  it('converges to the exact point slope rather than whole neighboring DEM cells', () => {
    for (const [u, v] of [
      [0, 0.173],
      [0.317, 0.5],
      [0.9999, 0.001]
    ]) {
      const cos = Math.sin(Math.PI * v),
        value = slope.sample(u, v, cos)
      const bound = slope.range({ u0: u, u1: u, v0: v, v1: v }, cos, cos)
      expect(bound.min).toBeLessThanOrEqual(value)
      expect(bound.max).toBeGreaterThanOrEqual(value)
      expect(bound.max - bound.min).toBeLessThan(1e-9)
    }
  })
})
