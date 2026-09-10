import { describe, expect, it } from 'vitest'
import {
  TerrainHeightField,
  terrainBlockTexels,
  terrainHurst,
  terrainLevelScale
} from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

describe('terrainLevelScale / terrainHurst: закон ε по уровням', () => {
  it('на 16k-карте L6 — ровно тексель: ε(7)/ε(6) = 1/2 (линейный режим), а степенной закон дал бы 2^-H', () => {
    const width = 16384
    const block = terrainBlockTexels(width) // 16
    const hurst = 0.7
    const s6 = terrainLevelScale(width, 6, block, hurst)
    const s7 = terrainLevelScale(width, 7, block, hurst)
    const s8 = terrainLevelScale(width, 8, block, hurst)
    expect(s7 / s6).toBeCloseTo(0.5, 12)
    expect(s8 / s6).toBeCloseTo(0.25, 12)
    expect(2 ** -hurst).toBeGreaterThan(0.5) // прежняя экстраполяция завышала
  })

  it('terrainHurst: клампится в [0.5, 1], вырожденные окна → 1', () => {
    expect(terrainHurst(2, 1)).toBe(1)
    expect(terrainHurst(1.5, 1)).toBeCloseTo(Math.log2(1.5), 12)
    expect(terrainHurst(1.05, 1)).toBe(0.5)
    expect(terrainHurst(0, 0)).toBe(1)
    expect(terrainHurst(1, 0)).toBe(1)
  })
})

function noisyMap(width: number, height: number): HeightMapData {
  const data = new Uint16Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = (k * 4001 + ((k * 7919) % 977) * 37) % 65535
  return { width, height, minMeters: -5000, maxMeters: 5000, data }
}

describe('TerrainHeightField: экстраполяция глубже TERRAIN_MODEL_LEVEL продолжает табличный закон', () => {
  it('ε(L) = ε(2)·terrainLevelScale(L) для всех L = 3..8 (карта 2048×1024, block 2)', () => {
    const map = noisyMap(2048, 1024)
    const field = new TerrainHeightField(map, 1737.4, { ...MIDBAND_DEFAULTS, midbandStrength: 0 })
    const block = terrainBlockTexels(map.width)
    const e1 = field.geometricErrorMeters(1)
    const e2 = field.geometricErrorMeters(2)
    const hurst = terrainHurst(e1, e2)
    for (let level = 3; level <= 8; level++) {
      expect(field.geometricErrorMeters(level)).toBeCloseTo(e2 * terrainLevelScale(map.width, level, block, hurst), 9)
    }
    // уровни ≤ 6 — табличные значения компаньона, они не менялись: тот же закон, что построил таблицу
    expect(field.geometricErrorMeters(6)).toBeCloseTo(e2 * terrainLevelScale(map.width, 6, block, hurst), 9)
  })
})
