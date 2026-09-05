import { describe, expect, it } from 'vitest'
import { Actor } from '@/core/models/Actor'
import {
  MIDBAND_DEFAULTS,
  midbandCacheKey,
  midbandParamsOf,
  midbandWavelengthMeters,
  resolveMidbandParams
} from '@/core/terrain/midbandParams'

describe('midbandParams: ручки геометрии средней полосы', () => {
  it('дефолты и авто-длина волны', () => {
    expect(MIDBAND_DEFAULTS).toEqual({
      midbandStrength: 1,
      midbandWavelengthKm: null,
      midbandFlat: 0.15,
      midbandSlopeRef: 0.15,
      midbandRidge: 1,
      midbandWarp: 0.35
    })
    expect(resolveMidbandParams(undefined, 'Луна')).toEqual(MIDBAND_DEFAULTS)
    expect(resolveMidbandParams({}, 'Луна')).toEqual(MIDBAND_DEFAULTS)
  })

  it('λ₀ = clamp(1.2·тексель, 800, 3000) м; явная ручка перебивает', () => {
    expect(midbandWavelengthMeters(1333, MIDBAND_DEFAULTS)).toBeCloseTo(1600, 6) // Луна 8192
    expect(midbandWavelengthMeters(500, MIDBAND_DEFAULTS)).toBe(800)
    expect(midbandWavelengthMeters(5000, MIDBAND_DEFAULTS)).toBe(3000)
    expect(midbandWavelengthMeters(1333, { ...MIDBAND_DEFAULTS, midbandWavelengthKm: 2.2 })).toBe(2200)
  })

  it('валидация громкая, с именем тела', () => {
    expect(() => resolveMidbandParams({ midbandStrength: -1 }, 'Титания')).toThrow(/Титания.*midbandStrength/)
    expect(() => resolveMidbandParams({ midbandWavelengthKm: 0 }, 'Титания')).toThrow(/midbandWavelengthKm/)
    expect(() => resolveMidbandParams({ midbandSlopeRef: 0 }, 'Титания')).toThrow(/midbandSlopeRef/)
    expect(() => resolveMidbandParams({ midbandFlat: 'x' }, 'Титания')).toThrow(/не число/)
    expect(() => resolveMidbandParams({ midbandWarp: -0.1 }, 'Титания')).toThrow(/midbandWarp/)
  })

  it('ключ кеша различает параметры, одинаковые параметры — один ключ', () => {
    expect(midbandCacheKey(MIDBAND_DEFAULTS)).toBe(midbandCacheKey({ ...MIDBAND_DEFAULTS }))
    expect(midbandCacheKey(MIDBAND_DEFAULTS)).not.toBe(midbandCacheKey({ ...MIDBAND_DEFAULTS, midbandStrength: 0 }))
  })

  it('midbandParamsOf читает data тела: у Луны (19) ручек нет — дефолты', () => {
    expect(midbandParamsOf(Actor.find(19)!)).toEqual(MIDBAND_DEFAULTS)
  })
})
