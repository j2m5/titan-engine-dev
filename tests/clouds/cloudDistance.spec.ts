import { describe, expect, it } from 'vitest'
import { cloudOpacityAtAltitude } from '@/labs/jupiter-clouds/cloudDistance'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'
import { cloudShellDistance, cloudVolumeOpacity } from '@/core/clouds/cloudLod'

describe('distance-limited cloud detail', () => {
  it('uses distance to the lower boundary for a narrow custom range', () => {
    expect(cloudOpacityAtAltitude(5000, { full: 0, cutoff: 10000 })).toBeCloseTo(0.5)
  })

  it('retains the existing default distance transition with the profile', () => {
    const profile = createJupiterCloudProfile()
    for (const altitude of [5000, 20000, 45000, 130000, 580000, 1030000, 90000000]) {
      expect(cloudOpacityAtAltitude(altitude)).toBeCloseTo(
        cloudVolumeOpacity(cloudShellDistance(altitude, profile.layers), profile.lod),
        10
      )
    }
  })
  it('keeps the orbital appearance unchanged and disables volume beyond the cutoff', () => {
    for (const altitude of [1030000, 2000000, 90000000]) {
      expect(cloudOpacityAtAltitude(altitude)).toBe(0)
    }
  })

  it('shows the complete volume near, inside and below the layer', () => {
    for (const altitude of [130000, 45000, 20000, 5000]) {
      expect(cloudOpacityAtAltitude(altitude)).toBe(1)
    }
  })

  it('smoothly fades relative to the top of the cloud layer', () => {
    expect(cloudOpacityAtAltitude(580000)).toBeCloseTo(0.5)
    let previous = 1
    for (let altitude = 130000; altitude <= 1030000; altitude += 10000) {
      const opacity = cloudOpacityAtAltitude(altitude)
      expect(opacity).toBeLessThanOrEqual(previous)
      expect(opacity).toBeGreaterThanOrEqual(0)
      previous = opacity
    }
    expect(cloudOpacityAtAltitude(130001)).toBeCloseTo(1, 8)
    expect(cloudOpacityAtAltitude(1029999)).toBeCloseTo(0, 8)
  })

  it('accepts a custom transition range without changing the cloud layer', () => {
    expect(cloudOpacityAtAltitude(130000, { full: 0, cutoff: 200000 })).toBeCloseTo(0.5)
  })

  it.each([
    { full: -1, cutoff: 1000 },
    { full: 1000, cutoff: 1000 },
    { full: 2000, cutoff: 1000 },
    { full: NaN, cutoff: 1000 },
    { full: 1000, cutoff: Infinity }
  ])('rejects a transition that cannot smoothly reach zero: %o', (range) => {
    expect(() => cloudOpacityAtAltitude(45000, range)).toThrow()
  })
})
