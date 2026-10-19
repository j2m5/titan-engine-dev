import type { CloudPattern } from '../CloudConfig'
import { coverageFromScalar, decodeCloudScalar, srgbToLinear, type CloudInputColorSpace } from '../cloudPatternMath'
import { decodeRgbCloud } from './rgbCloudMap'

type MappedPattern = Extract<CloudPattern, { kind: 'mask' | 'appearance' }>

/**
 * Compile coverage for native RGBA bytes already validated by readCloudImagePixelSteps.
 * Offsets must identify complete source pixels. The returned one-value scratch tuple
 * is borrowed until the next call: createCloudReduction consumes it immediately.
 * Neither source bytes nor the caller's configuration are changed.
 */
export function compileCloudByteCoverage(
  bytes: Uint8Array | Uint8ClampedArray,
  pattern: MappedPattern,
  space: CloudInputColorSpace
): (offset: number) => readonly [number] {
  const result: [number] = [0]
  const table = new Float64Array(256)
  if (pattern.kind === 'mask' && pattern.encoding === 'rgb-cloud-map') {
    // Keep the public decoder's validation; albedo is not needed for coverage.
    decodeRgbCloud([0, 0, 0], space)
    for (let byte = 0; byte < 256; byte++) table[byte] = space === 'srgb' ? srgbToLinear(byte / 255) : byte / 255
    return (offset) => {
      result[0] = Math.sqrt((table[bytes[offset]] + table[bytes[offset + 1]] + table[bytes[offset + 2]]) / 3)
      return result
    }
  }
  const decode = pattern.decode
  // Validate all configuration fields once, including appearance range and space.
  coverageFromScalar(decodeCloudScalar([0, 0, 0, 0], decode, space), pattern)
  if (decode.channel !== 'luminance') {
    for (let byte = 0; byte < 256; byte++) {
      const value = byte / 255
      table[byte] = coverageFromScalar(decodeCloudScalar([value, value, value, value], decode, space), pattern)
    }
    const channel = decode.channel === 'r' ? 0 : decode.channel === 'g' ? 1 : decode.channel === 'b' ? 2 : 3
    return (offset) => {
      result[0] = table[bytes[offset + channel]]
      return result
    }
  }
  // Obtain byte color conversion from the canonical decoder, without duplicating
  // its transfer functions. Nonlinear scalar normalization follows the RGB sum.
  const conversion = {
    ...decode,
    channel: 'r' as const,
    inputRange: [0, 1] as [number, number],
    invert: false,
    exponent: 1
  }
  for (let byte = 0; byte < 256; byte++) table[byte] = decodeCloudScalar([byte / 255, 0, 0, 0], conversion, space)
  const [low, high] = decode.inputRange,
    span = high - low,
    finiteSpan = Number.isFinite(span)
  const { invert, exponent } = decode
  const [coverageLow, coverageHigh] = pattern.kind === 'appearance' ? pattern.coverageRange : [0, 1]
  return (offset) => {
    const channel =
      0.2126 * table[bytes[offset]] + 0.7152 * table[bytes[offset + 1]] + 0.0722 * table[bytes[offset + 2]]
    const ratio = finiteSpan ? (channel - low) / span : (channel / 2 - low / 2) / (high / 2 - low / 2)
    const normalized = Math.max(0, Math.min(1, ratio))
    const scalar = (invert ? 1 - normalized : normalized) ** exponent
    result[0] = coverageLow + scalar * (coverageHigh - coverageLow)
    return result
  }
}
