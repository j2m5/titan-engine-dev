import type { CloudPattern, ScalarDecode } from './CloudConfig'

export type Rgba = readonly [number, number, number, number]
export type CloudInputColorSpace = 'srgb' | 'linear'

const srgbToLinear = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (value: number): number =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
const unit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

export function decodeCloudScalar(rgba: Rgba, decode: ScalarDecode, inputColorSpace: CloudInputColorSpace): number {
  if (
    !Array.isArray(rgba) ||
    rgba.length !== 4 ||
    ![rgba[0], rgba[1], rgba[2], rgba[3]].every(unit) ||
    !decode ||
    !['r', 'g', 'b', 'a', 'luminance'].includes(decode.channel) ||
    !['encoded', 'linear'].includes(decode.sampleSpace) ||
    typeof decode.invert !== 'boolean' ||
    !Number.isFinite(decode.exponent) ||
    decode.exponent <= 0 ||
    !Array.isArray(decode.inputRange) ||
    decode.inputRange.length !== 2 ||
    !Number.isFinite(decode.inputRange[0]) ||
    !Number.isFinite(decode.inputRange[1]) ||
    decode.inputRange[0] >= decode.inputRange[1] ||
    !['srgb', 'linear'].includes(inputColorSpace)
  ) {
    throw new RangeError('Invalid RGBA sample or scalar decode')
  }
  const convert =
    inputColorSpace === 'srgb' && decode.sampleSpace === 'linear'
      ? srgbToLinear
      : inputColorSpace === 'linear' && decode.sampleSpace === 'encoded'
        ? linearToSrgb
        : (value: number) => value
  const [r, g, b] = [convert(rgba[0]), convert(rgba[1]), convert(rgba[2])]
  const channel =
    decode.channel === 'luminance'
      ? 0.2126 * r + 0.7152 * g + 0.0722 * b
      : decode.channel === 'r'
        ? r
        : decode.channel === 'g'
          ? g
          : decode.channel === 'b'
            ? b
            : rgba[3]
  const [low, high] = decode.inputRange
  // Rescaling also handles finite endpoints whose subtraction would overflow.
  const span = high - low
  const ratio = Number.isFinite(span) ? (channel - low) / span : (channel / 2 - low / 2) / (high / 2 - low / 2)
  const normalized = Math.max(0, Math.min(1, ratio))
  return (decode.invert ? 1 - normalized : normalized) ** decode.exponent
}

export function coverageFromScalar(
  scalar: number,
  pattern: Extract<CloudPattern, { kind: 'mask' | 'appearance' }>
): number {
  if (!unit(scalar) || !pattern || (pattern.kind !== 'mask' && pattern.kind !== 'appearance')) {
    throw new RangeError('Invalid scalar or mapped cloud pattern')
  }
  if (pattern.kind === 'mask') return scalar
  const range = pattern.coverageRange
  if (!Array.isArray(range) || range.length !== 2 || !unit(range[0]) || !unit(range[1]) || range[0] > range[1]) {
    throw new RangeError('Invalid coverage range')
  }
  return range[0] + scalar * (range[1] - range[0])
}
