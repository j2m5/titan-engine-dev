import { expect, it } from 'vitest'
import { coverageFromScalar, decodeCloudScalar } from '@/core/clouds/cloudPatternMath'
import type { ScalarDecode } from '@/core/clouds/CloudConfig'
import type { Rgba } from '@/core/clouds/cloudPatternMath'
import { validCloudConfig } from './cloudFixtures'
const decode: ScalarDecode = { channel: 'r', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'linear' }
it('transfers RGB once while alpha remains independent', () => {
  expect(decodeCloudScalar([0.5, 0, 0, 0.5], decode, 'srgb')).toBeCloseTo(0.21404114, 7)
  expect(decodeCloudScalar([0.5, 0, 0, 0.5], decode, 'linear')).toBe(0.5)
  expect(decodeCloudScalar([0.5, 0, 0, 0.5], { ...decode, channel: 'a' }, 'srgb')).toBe(0.5)
  expect(decodeCloudScalar([0.21404114, 0, 0, 1], { ...decode, sampleSpace: 'encoded' }, 'linear')).toBeCloseTo(0.5, 7)
})
it.each([
  ['r', 0.2],
  ['g', 0.4],
  ['b', 0.6],
  ['a', 0.8],
  ['luminance', 0.37192]
] as const)('extracts %s', (channel, want) => {
  expect(decodeCloudScalar([0.2, 0.4, 0.6, 0.8], { ...decode, channel }, 'linear')).toBeCloseTo(want, 7)
})
it('normalizes, clamps, inverts then raises to the exponent', () => {
  const settings = { ...decode, inputRange: [0.2, 0.6] as [number, number], exponent: 2, invert: true }
  expect(decodeCloudScalar([0.4, 0, 0, 1], settings, 'linear')).toBeCloseTo(0.25)
  expect(decodeCloudScalar([0, 0, 0, 1], settings, 'linear')).toBe(1)
  expect(decodeCloudScalar([1, 0, 0, 1], settings, 'linear')).toBe(0)
})
it('keeps dark appearance cloudy and a black mask empty', () => {
  const appearance = validCloudConfig().layers[0].pattern
  if (appearance.kind !== 'appearance') throw new Error('Expected appearance')
  const mask = { kind: 'mask', map: appearance.map, decode: appearance.decode } as const
  expect(coverageFromScalar(0, appearance)).toBe(0.6)
  expect(coverageFromScalar(1, appearance)).toBe(0.95)
  expect(coverageFromScalar(0.5, appearance)).toBeCloseTo(0.775)
  expect(coverageFromScalar(0, mask)).toBe(0)
  expect(coverageFromScalar(1, { ...appearance, coverageRange: [0, 1] })).toBe(1)
})
it.each([NaN, Infinity, -1, 2])('rejects invalid scalar/sample %s', (value) => {
  expect(() => decodeCloudScalar([value, 0, 0, 1], decode, 'linear')).toThrow()
  expect(() => coverageFromScalar(value, { kind: 'mask', map: { resourceId: 1 }, decode })).toThrow()
})
it('rejects malformed decode ranges and coverage ranges', () => {
  expect(() => decodeCloudScalar([0, 0, 0, 1], { ...decode, inputRange: [1, 1] }, 'linear')).toThrow()
  expect(() => decodeCloudScalar([0, 0, 0, 1], { ...decode, exponent: 0 }, 'linear')).toThrow()
  const appearance = validCloudConfig().layers[0].pattern
  if (appearance.kind !== 'appearance') throw new Error('Expected appearance')
  expect(() => coverageFromScalar(0.5, { ...appearance, coverageRange: [1, 0] })).toThrow()
})
it('rejects sparse RGBA and range tuples from untrusted callers', () => {
  const rgba = [0.5, 0.5, 0.5, 1] as unknown as Rgba
  Reflect.deleteProperty(rgba, 1)
  expect(() => decodeCloudScalar(rgba, decode, 'linear')).toThrow()
  const inputRange: [number, number] = [0, 1]
  Reflect.deleteProperty(inputRange, 0)
  expect(() => decodeCloudScalar([0.5, 0, 0, 1], { ...decode, inputRange }, 'linear')).toThrow()
  const appearance = validCloudConfig().layers[0].pattern
  if (appearance.kind !== 'appearance') throw new Error('Expected appearance')
  const coverageRange: [number, number] = [0, 1]
  Reflect.deleteProperty(coverageRange, 0)
  expect(() => coverageFromScalar(0.5, { ...appearance, coverageRange })).toThrow()
})
