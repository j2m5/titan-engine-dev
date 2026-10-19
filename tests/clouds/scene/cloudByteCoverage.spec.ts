import { describe, expect, it } from 'vitest'
import type { CloudPattern, ScalarDecode } from '@/core/clouds/CloudConfig'
import { coverageFromScalar, decodeCloudScalar, type CloudInputColorSpace } from '@/core/clouds/cloudPatternMath'
import { decodeRgbCloud } from '@/core/clouds/appearance/rgbCloudMap'
import { createCloudReduction } from '@/core/clouds/appearance/cloudPreparationSteps'
import * as samplerModule from '@/core/clouds/appearance/cloudByteCoverage'

type MappedPattern = Extract<CloudPattern, { kind: 'mask' | 'appearance' }>
type Compile = (
  bytes: Uint8Array | Uint8ClampedArray,
  pattern: MappedPattern,
  space: CloudInputColorSpace
) => (at: number) => readonly number[]
const compile = (...args: Parameters<Compile>): ReturnType<Compile> => {
  const implementation = Reflect.get(samplerModule, 'compileCloudByteCoverage')
  expect(implementation, 'compiled byte coverage API').toBeTypeOf('function')
  return implementation(...args)
}
const bytes = Uint8Array.from({ length: 256 * 4 }, (_, i) => {
  const pixel = Math.floor(i / 4),
    channel = i % 4
  return channel === 0 ? pixel : channel === 1 ? 255 - pixel : channel === 2 ? (pixel * 73) % 256 : (pixel * 19) % 256
})
const canonical = (
  input: Uint8Array | Uint8ClampedArray,
  at: number,
  pattern: MappedPattern,
  space: CloudInputColorSpace
): number => {
  const rgba: [number, number, number, number] = [
    input[at] / 255,
    input[at + 1] / 255,
    input[at + 2] / 255,
    input[at + 3] / 255
  ]
  return pattern.kind === 'mask' && pattern.encoding === 'rgb-cloud-map'
    ? decodeRgbCloud([rgba[0], rgba[1], rgba[2]], space).coverage
    : coverageFromScalar(decodeCloudScalar(rgba, pattern.decode, space), pattern)
}
const scalar = (decode: Partial<ScalarDecode> = {}, appearance = false): MappedPattern => {
  const d: ScalarDecode = {
    channel: 'luminance',
    inputRange: [0, 1],
    exponent: 1,
    invert: false,
    sampleSpace: 'encoded',
    ...decode
  }
  return appearance
    ? { kind: 'appearance', map: { resourceId: 32 }, decode: d, coverageRange: [0.1, 0.45] }
    : { kind: 'mask', map: { resourceId: 26 }, decode: d }
}

describe('compiled native RGBA byte coverage', () => {
  it.each(['srgb', 'linear'] as const)(
    'exactly matches RGB coverage at every byte level with asymmetric colors (%s)',
    (space) => {
      const pattern: MappedPattern = { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 26 } }
      const sample = compile(bytes, pattern, space)
      for (let at = 0; at < bytes.length; at += 4) expect(sample(at)[0]).toBe(canonical(bytes, at, pattern, space))
    }
  )
  it('exactly matches all scalar channels/input spaces, nonlinear ranges and appearance remapping', () => {
    for (const space of ['srgb', 'linear'] as const)
      for (const sampleSpace of ['encoded', 'linear'] as const)
        for (const channel of ['r', 'g', 'b', 'a', 'luminance'] as const)
          for (const appearance of [false, true])
            for (const parameters of [
              { inputRange: [0, 1], exponent: 1, invert: false },
              { inputRange: [0.13, 0.81], exponent: 0.7, invert: true },
              { inputRange: [-Number.MAX_VALUE, Number.MAX_VALUE], exponent: 2.3, invert: false },
              { inputRange: [0, Number.MIN_VALUE], exponent: Number.MAX_VALUE, invert: true },
              { inputRange: [-Number.MAX_VALUE, -1], exponent: Number.MIN_VALUE, invert: false }
            ] as const) {
              const pattern = scalar(
                { channel, sampleSpace, ...parameters, inputRange: [...parameters.inputRange] },
                appearance
              )
              const sample = compile(bytes, pattern, space)
              for (let at = 0; at < bytes.length; at += 4)
                expect(sample(at)[0]).toBe(canonical(bytes, at, pattern, space))
            }
  })
  it('leaves alpha unconverted and accepts clamped native byte storage without mutating it', () => {
    const input = new Uint8ClampedArray([0, 83, 255, 127, 255, 0, 64, 255]),
      before = input.slice()
    for (const space of ['srgb', 'linear'] as const) {
      const pattern = scalar({ channel: 'a', sampleSpace: 'linear' })
      const sample = compile(input, pattern, space)
      expect(sample(0)[0]).toBe(127 / 255)
      expect(sample(4)[0]).toBe(1)
    }
    expect(input).toEqual(before)
  })
  it('preserves canonical byte output and fractional sample order across bounded reduction steps', () => {
    const input = Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => (i * 37) % 256)
    for (const pattern of [
      scalar({ exponent: 2.3, invert: true }, true),
      { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 26 } } as const
    ]) {
      const actual = createCloudReduction(7, 5, 3, 2, compile(input, pattern, 'srgb'), 1)
      const expected = createCloudReduction(7, 5, 3, 2, (at) => [canonical(input, at, pattern, 'srgb')], 1)
      while (!actual.step(1)) {
        /* immediate consumption of each sample */
      }
      while (!expected.step(7)) {
        /* different scheduling, same traversal */
      }
      expect(actual.output).toEqual(expected.output)
    }
  })
  it('rejects invalid decode/ranges/color space once, including otherwise unused RGB channels', () => {
    const invalid = [
      { channel: 'unknown' },
      { sampleSpace: 'unknown' },
      { exponent: 0 },
      { exponent: NaN },
      { invert: 1 },
      { inputRange: [0, 0] },
      { inputRange: [1, 0] },
      { inputRange: [0, Infinity] }
    ]
    for (const decode of invalid)
      expect(() => compile(bytes, scalar(decode as Partial<ScalarDecode>), 'srgb')).toThrow(RangeError)
    for (const coverageRange of [
      [-1, 1],
      [0, 2],
      [0.8, 0.2],
      [0, NaN]
    ]) {
      const pattern = { ...scalar({}, true), coverageRange } as MappedPattern
      expect(() => compile(bytes, pattern, 'linear')).toThrow(RangeError)
    }
    for (const pattern of [scalar(), { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 26 } } as const])
      expect(() => compile(bytes, pattern, 'unknown' as CloudInputColorSpace)).toThrow(RangeError)
  })
})
