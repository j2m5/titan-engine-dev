// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createTitanCloudCoverage, sampleTitanCloudCoverage } from '../../scripts/lib/titanCloudCoverage'

function direction(u: number, latitudeDegrees: number): [number, number, number] {
  const latitude = (latitudeDegrees * Math.PI) / 180
  const phi = u * 2 * Math.PI
  return [-Math.cos(phi) * Math.cos(latitude), Math.sin(latitude), Math.sin(phi) * Math.cos(latitude)]
}

describe('offline Titan methane coverage', () => {
  it('reproduces the same north-first 2:1 linear byte mask', () => {
    const first = createTitanCloudCoverage(128)
    expect(first.width).toBe(128)
    expect(first.height).toBe(64)
    expect(first.data).toHaveLength(128 * 64)
    expect(createTitanCloudCoverage(128).data).toEqual(first.data)
    // North/south orientation and half-texel centres match the production image loader.
    for (const [x, y] of [
      [0, 8],
      [64, 12],
      [36, 48],
      [127, 51]
    ]) {
      const normal = direction((x + 0.5) / first.width, 90 - ((y + 0.5) * 180) / first.height)
      expect(first.data[y * first.width + x]).toBe(Math.round(255 * sampleTitanCloudCoverage(normal)))
    }
  })

  it('has continuous clouds across the longitude seam, including a nonempty seam crossing', () => {
    let seamPeak = 0
    for (let latitude = -80; latitude <= 80; latitude += 0.5) {
      const left = sampleTitanCloudCoverage(direction(1e-7, latitude))
      const right = sampleTitanCloudCoverage(direction(1 - 1e-7, latitude))
      expect(Math.abs(left - right)).toBeLessThan(0.0001)
      expect(sampleTitanCloudCoverage(direction(0.23, latitude))).toBeCloseTo(
        sampleTitanCloudCoverage(direction(1.23, latitude)),
        10
      )
      seamPeak = Math.max(seamPeak, left)
    }
    expect(seamPeak).toBeGreaterThan(0.5)
  })

  it('converges at each pole without longitude pinching', () => {
    for (const latitude of [-90, 90]) {
      const pole = sampleTitanCloudCoverage(direction(0, latitude))
      for (let u = 0; u < 1; u += 0.03125) {
        expect(sampleTitanCloudCoverage(direction(u, latitude))).toBeCloseTo(pole, 12)
        expect(sampleTitanCloudCoverage(direction(u, latitude * 0.99999))).toBeCloseTo(pole, 4)
      }
    }
  })

  it('keeps most of the globe clear with separate southern and northern cloud systems', () => {
    const { width, height, data } = createTitanCloudCoverage(512)
    const bands = { north: [0, 0], south: [0, 0], tropical: [0, 0], globe: [0, 0] }
    let peak = 0
    for (let y = 0; y < height; y++) {
      const latitude = 90 - ((y + 0.5) * 180) / height
      const weight = Math.cos((latitude * Math.PI) / 180)
      const band = latitude > 45 ? bands.north : latitude < -35 ? bands.south : bands.tropical
      for (let x = 0; x < width; x++) {
        const value = data[y * width + x]
        const cloudy = value > 25 ? weight : 0
        band[0] += cloudy
        band[1] += weight
        bands.globe[0] += cloudy
        bands.globe[1] += weight
        peak = Math.max(peak, value)
      }
    }
    const fraction = ([cloudy, area]: number[]) => cloudy / area
    expect(fraction(bands.globe)).toBeGreaterThan(0.01)
    expect(fraction(bands.globe)).toBeLessThan(0.18)
    expect(fraction(bands.south)).toBeGreaterThan(0.04)
    expect(fraction(bands.north)).toBeGreaterThan(0.005)
    expect(fraction(bands.tropical)).toBeLessThan(fraction(bands.south) / 4)
    expect(peak).toBeGreaterThan(220)
  })

  it.each([0, 1, 63, 65, 128.5, 8192, NaN, Infinity])('rejects unsupported width %s before allocation', (width) => {
    expect(() => createTitanCloudCoverage(width)).toThrow(/width/i)
  })
})
