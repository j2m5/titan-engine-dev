import { srgbToLinear, type CloudInputColorSpace } from '@/core/clouds/cloudPatternMath'

export function decodeRgbCloud(
  rgb: readonly [number, number, number],
  space: CloudInputColorSpace
): { coverage: number; albedo: [number, number, number] } {
  if (
    rgb.length !== 3 ||
    !rgb.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ||
    !['srgb', 'linear'].includes(space)
  )
    throw new RangeError('Cloud RGB must be finite and in [0, 1]')
  const c = rgb.map((x) => (space === 'srgb' ? srgbToLinear(x) : x))
  const coverage = Math.sqrt((c[0] + c[1] + c[2]) / 3)
  const denominator = Math.max(coverage, 1e-4)
  return { coverage, albedo: c.map((x) => Math.min(x / denominator, 1)) as [number, number, number] }
}

// texture lookup supplies linear RGB; the texture owns the sRGB conversion.
export const rgbCloudMapGLSL = `
struct RgbCloudSample { float coverage; vec3 albedo; };
RgbCloudSample decodeRgbCloud(vec3 rgb) {
  float a = sqrt(dot(rgb, vec3(1.0 / 3.0)));
  return RgbCloudSample(a, min(rgb / max(a, 1e-4), vec3(1.0)));
}`
