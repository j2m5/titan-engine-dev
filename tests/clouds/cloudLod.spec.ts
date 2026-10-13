import { expect, it } from 'vitest'
import { cloudShellDistance, cloudVolumeOpacity } from '@/core/clouds/cloudLod'
const layers = [{ baseAltitudeMeters: 10000, thicknessMeters: 20000 }]
const lod = { fullDistanceMeters: 100000, cutoffDistanceMeters: 1000000 }
it.each([
  [5000, 5000],
  [10000, 0],
  [20000, 0],
  [30000, 0],
  [580000, 550000]
])('measures shell distance at %s', (altitude, want) => {
  expect(cloudShellDistance(altitude, layers)).toBe(want)
})
it('uses the nearest shell and zero inside either shell', () => {
  const shells = [...layers, { baseAltitudeMeters: 40000, thicknessMeters: 10000 }]
  expect(cloudShellDistance(37000, shells)).toBe(3000)
  expect(cloudShellDistance(45000, shells)).toBe(0)
  expect(cloudShellDistance(20000, shells)).toBe(0)
})
it.each([
  [0, 1],
  [100000, 1],
  [325000, 0.84375],
  [550000, 0.5],
  [775000, 0.15625],
  [1000000, 0],
  [2000000, 0]
])('fades smoothly at distance %s', (distance, want) => {
  expect(cloudVolumeOpacity(distance, lod)).toBe(want)
})
it('rejects empty shells, malformed altitudes and invalid dimensions', () => {
  expect(() => cloudShellDistance(0, [])).toThrow()
  for (const value of [NaN, Infinity]) expect(() => cloudShellDistance(value, layers)).toThrow()
  expect(() => cloudShellDistance(0, [{ baseAltitudeMeters: -1, thicknessMeters: 1 }])).toThrow()
  expect(() => cloudShellDistance(0, [{ baseAltitudeMeters: 0, thicknessMeters: 0 }])).toThrow()
})
it('rejects malformed distances and LOD ranges', () => {
  for (const value of [-1, NaN, Infinity]) expect(() => cloudVolumeOpacity(value, lod)).toThrow()
  expect(() => cloudVolumeOpacity(1, { fullDistanceMeters: 1, cutoffDistanceMeters: 1 })).toThrow()
  expect(() => cloudVolumeOpacity(1, { fullDistanceMeters: -1, cutoffDistanceMeters: 1 })).toThrow()
})
