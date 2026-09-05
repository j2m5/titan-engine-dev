import { describe, expect, it } from 'vitest'
import { WATER_FOAM_DEFAULTS, resolveWaterFoamParams } from '@/core/terrain/waterFoamParams'

describe('resolveWaterFoamParams: ручки пены прибоя и мокрой кромки', () => {
  it('дефолты при отсутствии ручек и при отсутствии data', () => {
    expect(resolveWaterFoamParams({}, 'Земля')).toEqual({
      waterFoamStrength: 1,
      waterFoamShoreMeters: 600,
      waterFoamSurfMeters: 3000,
      waterFoamWavelengthMeters: 800,
      waterFoamPeriodSeconds: 8,
      waterFoamNoiseScale: 1,
      waterFoamColor: 0xe6e9ec,
      terrainWetBandMeters: 3,
      terrainWetDarken: 0.35
    })
    expect(resolveWaterFoamParams(undefined, 'Земля')).toEqual(WATER_FOAM_DEFAULTS)
  })

  it('заданные значения доезжают, остальные — дефолт', () => {
    const p = resolveWaterFoamParams({ waterFoamStrength: 0, waterFoamShoreMeters: 1000, waterFoamColor: '#ffffff' }, 'Явин IV')
    expect(p.waterFoamStrength).toBe(0)
    expect(p.waterFoamShoreMeters).toBe(1000)
    expect(p.waterFoamColor).toBe('#ffffff')
    expect(p.waterFoamSurfMeters).toBe(3000)
  })

  it('валидация громкая, с именем тела и именем поля', () => {
    expect(() => resolveWaterFoamParams({ waterFoamStrength: -1 }, 'Явин IV')).toThrow(/Явин IV/)
    expect(() => resolveWaterFoamParams({ waterFoamStrength: -1 }, 'Явин IV')).toThrow(/waterFoamStrength/)
    expect(() => resolveWaterFoamParams({ waterFoamShoreMeters: 0 }, 'Явин IV')).toThrow(/waterFoamShoreMeters/)
    expect(() => resolveWaterFoamParams({ waterFoamSurfMeters: 600 }, 'Явин IV')).toThrow(/waterFoamSurfMeters/)
    expect(() => resolveWaterFoamParams({ waterFoamShoreMeters: 4000 }, 'Явин IV')).toThrow(/waterFoamSurfMeters/)
    expect(() => resolveWaterFoamParams({ waterFoamWavelengthMeters: -5 }, 'Явин IV')).toThrow(/waterFoamWavelengthMeters/)
    expect(() => resolveWaterFoamParams({ waterFoamPeriodSeconds: 0 }, 'Явин IV')).toThrow(/waterFoamPeriodSeconds/)
    expect(() => resolveWaterFoamParams({ waterFoamNoiseScale: 0 }, 'Явин IV')).toThrow(/waterFoamNoiseScale/)
    expect(() => resolveWaterFoamParams({ terrainWetBandMeters: 0 }, 'Явин IV')).toThrow(/terrainWetBandMeters/)
    expect(() => resolveWaterFoamParams({ terrainWetDarken: 1.5 }, 'Явин IV')).toThrow(/terrainWetDarken/)
    expect(() => resolveWaterFoamParams({ terrainWetDarken: -0.1 }, 'Явин IV')).toThrow(/terrainWetDarken/)
    expect(() => resolveWaterFoamParams({ waterFoamStrength: 'x' }, 'Явин IV')).toThrow(/не число/)
    expect(() => resolveWaterFoamParams({ waterFoamStrength: Number.NaN }, 'Явин IV')).toThrow(/не число/)
    expect(() => resolveWaterFoamParams({ waterFoamColor: 12.5 }, 'Явин IV')).toThrow(/waterFoamColor/)
    expect(() => resolveWaterFoamParams({ waterFoamColor: true }, 'Явин IV')).toThrow(/waterFoamColor/)
  })
})
