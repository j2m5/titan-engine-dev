import { describe, expect, it } from 'vitest'
import { WATER_SURFACE_DEFAULTS, resolveWaterSurfaceParams } from '@/core/terrain/waterSurfaceParams'

describe('resolveWaterSurfaceParams', () => {
  it('дефолты без data', () => {
    expect(resolveWaterSurfaceParams(undefined, 'x')).toEqual(WATER_SURFACE_DEFAULTS)
    expect(WATER_SURFACE_DEFAULTS).toEqual({ waterRoughness: 0.02, waterAbsorption: [0.45, 0.07, 0.03], waterRippleStrength: 1, waterGlintGain: 1 })
  })
  it('заданные значения проходят', () => {
    expect(resolveWaterSurfaceParams({ waterRoughness: 0.1, waterAbsorption: [1, 0.5, 0.2], waterRippleStrength: 0 }, 'x')).toEqual({
      waterRoughness: 0.1, waterAbsorption: [1, 0.5, 0.2], waterRippleStrength: 0, waterGlintGain: 1
    })
  })
  it('валидация громкая, с именем тела', () => {
    expect(() => resolveWaterSurfaceParams({ waterRoughness: 0 }, 'Земля')).toThrow('Земля')
    expect(() => resolveWaterSurfaceParams({ waterRoughness: 1.5 }, 'x')).toThrow('(0, 1]')
    expect(() => resolveWaterSurfaceParams({ waterAbsorption: [1, 2] }, 'x')).toThrow('три')
    expect(() => resolveWaterSurfaceParams({ waterAbsorption: [1, 0, 1] }, 'x')).toThrow('> 0')
    expect(() => resolveWaterSurfaceParams({ waterRippleStrength: -1 }, 'x')).toThrow('>= 0')
    expect(() => resolveWaterSurfaceParams({ waterRippleStrength: 'a' }, 'x')).toThrow('не число')
  })
})
