import { Color } from 'three'
import { resolveFrostParams } from '@/core/terrain/frostParams'

describe('resolveFrostParams', () => {
  it('дефолты', () => {
    const p = resolveFrostParams(undefined, 'x')
    expect(p.frostStrength).toBe(0)
    expect(p.frostLineMeters).toBe(0)
    expect(p.frostLineWidthMeters).toBe(500)
    expect(p.frostPolarDropMeters).toBe(0)
    expect(p.frostAspectMeters).toBe(0)
    expect(p.frostSlopeMax).toBe(0.6)
    expect(p.frostColor.equals(new Color(0xf0f2f5))).toBe(true)
  })

  it('валидация громкая, с именем тела', () => {
    expect(() => resolveFrostParams({ frostStrength: 1.5 }, 'Адриана')).toThrow('Адриана')
    expect(() => resolveFrostParams({ frostLineWidthMeters: 0 }, 'x')).toThrow('> 0')
    expect(() => resolveFrostParams({ frostSlopeMax: 0 }, 'x')).toThrow('> 0')
    expect(() => resolveFrostParams({ frostPolarDropMeters: -1 }, 'x')).toThrow('>= 0')
    expect(() => resolveFrostParams({ frostAspectMeters: -1 }, 'x')).toThrow('>= 0')
    expect(() => resolveFrostParams({ frostLineMeters: 'a' }, 'x')).toThrow('не число')
    expect(() => resolveFrostParams({ frostColor: {} }, 'x')).toThrow('hex')
  })
})
