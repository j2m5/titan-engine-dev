import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** Keep NaN ray intervals out of shadow history. A live isnan check also makes
 * ANGLE/D3D compile this kernel with IEEE strictness. At planetary coordinates its
 * separately linked programs otherwise produced different shadow results
 * from identical inputs. Keep the check in the shared cascade, before packing.
 */
export function adaptSceneCloudShadowNumerics(source: string): string {
  const anchor = 'vec3 rayOrigin = rayNear * rayDirection + sunPosition;'
  source = replaceExactlyOnce(
    source,
    anchor,
    `if (any(isnan(vec2(rayNear, rayFar)))) {
    outputColor = vec4(0.0);
    outputDepthVelocity = vec3(0.0);
    return;
  }
  ${anchor}`,
    'scene cloud shadow numerics',
    'ray interval'
  )
  // Empty rays have no optical depth. Their upstream distance sentinel can be
  // millions of metres and becomes NaN in SwiftShader's half-float conversion.
  // Retain a far, finite front when filtering with occupied texels: a zero front
  // would pull their shadow toward the light. 65504 is the largest finite half.
  source = replaceExactlyOnce(
    source,
    'return vec4(maxRayDistance, 0.0, 0.0, 0.0);',
    'return vec4(clamp(maxRayDistance, 0.0, 65504.0), 0.0, 0.0, 0.0);',
    'scene cloud shadow numerics',
    'empty march'
  )
  source = replaceExactlyOnce(
    source,
    'outputColor = color;',
    `outputColor = color;
  if (color.g == 0.0) {
    outputDepthVelocity = vec3(-1.0, 0.0, 0.0);
    return;
  }`,
    'scene cloud shadow numerics',
    'empty history'
  )
  // Motion larger than one image already rejects history for every current UV.
  // Preserve that rejection without overflowing either half-float component.
  return replaceExactlyOnce(
    source,
    'outputDepthVelocity = vec3(color.x, velocity);',
    'outputDepthVelocity = vec3(color.x, clamp(velocity, -resolution, resolution));',
    'scene cloud shadow numerics',
    'history motion'
  )
}

/** Jitter can produce occupied negative depths, including the empty marker -1.
 * Resolve that collision from the existing optical layer's extinction. */
export function adaptSceneCloudShadowResolveNumerics(source: string): string {
  // Takram expands this fixed 3x3 loop before exposing the material source.
  const pattern = /neighborOffsets\[(\d)\]\s*\);\s*if \(neighbor\.r < result\.r\) \{/g
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 9 || matches.some((match, index) => Number(match[1]) !== index))
    throw new Error('Scene cloud shadow history must contain nine ordered neighbor comparisons')
  return source.replace(pattern, (match, index: string) =>
    match.replace(
      'if (neighbor.r < result.r) {',
      `if (neighbor.r < result.r && (neighbor.r != -1.0 ||
      texelFetchOffset(inputBuffer, coord, 0, neighborOffsets[${index}]).g > 0.0)) {`
    )
  )
}
