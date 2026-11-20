import { expect, it } from 'vitest'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'

it('shares computed map-only buffers across field radii and relief parameters without claiming a baked companion', () => {
  const map: HeightMapData = {
    width: 128, height: 64, minMeters: -1000, maxMeters: 1000,
    data: Uint16Array.from({ length: 128 * 64 }, (_, i) => (i * 173) % 65536)
  }
  const first = new TerrainHeightField(map, 1000, { ...MIDBAND_DEFAULTS, midbandStrength: 0, bedrockStrength: 0 })
  const second = new TerrainHeightField(map, 2000, { ...MIDBAND_DEFAULTS, midbandStrength: 0.5, bedrockStrength: 0.5 })
  const a = first.exportAux(), b = second.exportAux()
  for (const key of ['clearanceGrid', 'levelErrorMeters', 'nodeMaxHeightMetersPyramid', 'nodeErrorMetersPyramid'] as const) {
    expect(b[key]).toBe(a[key])
  }
  expect(first.usedBakedAux).toBe(false)
  expect(second.usedBakedAux).toBe(false)
  expect(map.aux).toBeUndefined()
  expect(second.equatorTexelMeters).toBe(first.equatorTexelMeters * 2)
  expect(first.midband).toBeNull()
  expect(second.midband).not.toBeNull()
  expect(first.bedrock).toBeNull()
  expect(second.bedrock).not.toBeNull()
})
