import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** Adapt the pinned sparse resolve without increasing the raymarch budget.
 * Opacity clips independently of lighting; new samples accumulate only after
 * the first Bayer cycle, and motion relaxes accumulation to avoid trailing.
 */
export function adaptSceneCloudTemporalResolve(source: string): string {
  let shader = replaceExactlyOnce(
    source,
    /vec4 clipAABB\([^]*?\n\}/g,
    `vec4 clipAABB(const vec4 current, const vec4 history, const vec4 minColor, const vec4 maxColor) {
  vec3 pClip = 0.5 * (maxColor.rgb + minColor.rgb);
  vec3 eClip = 0.5 * (maxColor.rgb - minColor.rgb) + 1e-7;
  vec3 vClip = history.rgb - pClip;
  vec3 vUnit = vClip / eClip;
  vec3 aUnit = abs(vUnit);
  float maUnit = max(aUnit.x, max(aUnit.y, aUnit.z));
  float alpha = clamp(history.a, minColor.a, maxColor.a);
  if (maUnit > 1.0) {
    return vec4(pClip + vClip / maUnit, alpha);
  }
  return vec4(history.rgb, alpha);
}`,
    'scene cloud resolve',
    'independent opacity history'
  )
  shader = replaceExactlyOnce(
    shader,
    'if (currentFrame) {',
    'if (currentFrame && frame <= 16) {',
    'scene cloud resolve',
    'fresh pixel bootstrap'
  )
  return replaceExactlyOnce(
    shader,
    'outputColor = clippedColor;',
    `// Only 1/16 of the resolve pixels receives a fresh raymarch sample.
  // Keep its clipped history at rest; fully trust the sample above 2 pixels/frame.
  vec2 motionPixels = abs(velocity / texelSize);
  float currentWeight = mix(0.5, 1.0, smoothstep(0.5, 2.0, max(motionPixels.x, motionPixels.y)));
  // Mixed neighborhoods cannot identify disocclusion by variance alone.
  // React to opacity changes independently of RGB, and clear fresh empty rays.
  currentWeight = max(currentWeight, smoothstep(0.05, 0.15, abs(currentColor.a - clippedColor.a)));
  if (currentColor.a <= 0.0) currentWeight = 1.0;
  outputColor = currentFrame ? mix(clippedColor, currentColor, currentWeight) : clippedColor;`,
    'scene cloud resolve',
    'fresh pixel accumulation'
  )
}
