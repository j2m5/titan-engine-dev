import { describe, expect, it } from 'vitest'
import { resolveTerrainLightParams } from '@/core/terrain/terrainLightParams'

describe('terrainLightParams: ручки света суши', () => {
  it('дефолты: окклюзия на прямом 0.35, небо 1, тень облаков 0.6 / 6 км', () => {
    expect(resolveTerrainLightParams({}, 'x')).toEqual({
      terrainOcclusionDirect: 0.35,
      skyAmbientStrength: 1,
      cloudShadowStrength: 0.6,
      cloudHeightKm: 6,
      cloudLightSoftness: 0.1,
      terrainShadowStrength: 1,
      terrainShadowSoftness: 1,
      iceGlintStrength: 0,
      nearShadowStrength: 1
    })
    expect(resolveTerrainLightParams(undefined, 'x').skyAmbientStrength).toBe(1)
  })

  it('значения из data доезжают', () => {
    const p = resolveTerrainLightParams({ terrainOcclusionDirect: 1, skyAmbientStrength: 0, cloudShadowStrength: 0, cloudHeightKm: 10, cloudLightSoftness: 0.2, terrainShadowStrength: 0, terrainShadowSoftness: 2, iceGlintStrength: 0.35, nearShadowStrength: 0.4 }, 'x')
    expect(p).toEqual({ terrainOcclusionDirect: 1, skyAmbientStrength: 0, cloudShadowStrength: 0, cloudHeightKm: 10, cloudLightSoftness: 0.2, terrainShadowStrength: 0, terrainShadowSoftness: 2, iceGlintStrength: 0.35, nearShadowStrength: 0.4 })
  })

  it('громкая валидация: доли вне [0,1], высота ≤ 0, не число', () => {
    expect(() => resolveTerrainLightParams({ terrainOcclusionDirect: 1.5 }, 'Луна')).toThrow(/terrainLight Луна: terrainOcclusionDirect/)
    expect(() => resolveTerrainLightParams({ skyAmbientStrength: -0.1 }, 'Луна')).toThrow(/skyAmbientStrength/)
    expect(() => resolveTerrainLightParams({ cloudShadowStrength: 2 }, 'Луна')).toThrow(/cloudShadowStrength/)
    expect(() => resolveTerrainLightParams({ cloudHeightKm: 0 }, 'Луна')).toThrow(/cloudHeightKm/)
    expect(() => resolveTerrainLightParams({ terrainOcclusionDirect: 'x' }, 'Луна')).toThrow(/не число/)
    expect(() => resolveTerrainLightParams({ iceGlintStrength: 1.5 }, 'Луна')).toThrow(/\[0, 1\]/)
    expect(() => resolveTerrainLightParams({ nearShadowStrength: 1.01 }, 'Луна')).toThrow(/nearShadowStrength должен быть в \[0, 1\]/)
    expect(() => resolveTerrainLightParams({ nearShadowStrength: -0.01 }, 'Луна')).toThrow(/nearShadowStrength/)
    expect(() => resolveTerrainLightParams({ nearShadowStrength: 'x' }, 'Луна')).toThrow(/nearShadowStrength — не число/)
    expect(resolveTerrainLightParams({ nearShadowStrength: 0 }, 'Луна').nearShadowStrength).toBe(0)
  })
})
