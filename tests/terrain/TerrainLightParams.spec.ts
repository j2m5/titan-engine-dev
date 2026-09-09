import { describe, expect, it } from 'vitest'
import { resolveTerrainLightParams } from '@/core/terrain/terrainLightParams'

describe('terrainLightParams: ручки света суши', () => {
  it('дефолты: окклюзия на прямом 0.35, небо 1, тень облаков 0.6 / 6 км', () => {
    expect(resolveTerrainLightParams({}, 'x')).toEqual({
      terrainOcclusionDirect: 0.35,
      skyAmbientStrength: 1,
      cloudShadowStrength: 0.6,
      cloudShadowHeightKm: 6
    })
    expect(resolveTerrainLightParams(undefined, 'x').skyAmbientStrength).toBe(1)
  })

  it('значения из data доезжают', () => {
    const p = resolveTerrainLightParams({ terrainOcclusionDirect: 1, skyAmbientStrength: 0, cloudShadowStrength: 0, cloudShadowHeightKm: 10 }, 'x')
    expect(p).toEqual({ terrainOcclusionDirect: 1, skyAmbientStrength: 0, cloudShadowStrength: 0, cloudShadowHeightKm: 10 })
  })

  it('громкая валидация: доли вне [0,1], высота ≤ 0, не число', () => {
    expect(() => resolveTerrainLightParams({ terrainOcclusionDirect: 1.5 }, 'Луна')).toThrow(/terrainLight Луна: terrainOcclusionDirect/)
    expect(() => resolveTerrainLightParams({ skyAmbientStrength: -0.1 }, 'Луна')).toThrow(/skyAmbientStrength/)
    expect(() => resolveTerrainLightParams({ cloudShadowStrength: 2 }, 'Луна')).toThrow(/cloudShadowStrength/)
    expect(() => resolveTerrainLightParams({ cloudShadowHeightKm: 0 }, 'Луна')).toThrow(/cloudShadowHeightKm/)
    expect(() => resolveTerrainLightParams({ terrainOcclusionDirect: 'x' }, 'Луна')).toThrow(/не число/)
  })
})
