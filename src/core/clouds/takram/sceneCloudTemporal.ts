import type { CloudsEffect } from '@takram/three-clouds'
import { Uniform } from 'three'
import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** The public effect renders the shadow map once, then publishes the overlay
 * after this pass. Complete a still inside that interval so every ray uses
 * the same camera, scene depth, shadow and simulation time. */
export function bindSceneCloudCapture(pass: CloudsEffect['cloudsPass']) {
  const enabled = new Uniform(false)
  const uniforms = pass.resolveMaterial.uniforms
  const previousUniform = uniforms.sceneCloudCapture
  const update = pass.update
  uniforms.sceneCloudCapture = enabled
  pass.update = function (renderer, frame, deltaTime) {
    update.call(this, renderer, frame, deltaTime)
    if (enabled.value && this.temporalUpscale) {
      // The pinned sparse march samples a different location in each 4×4 tile.
      for (let phase = 1; phase < 16; phase++) update.call(this, renderer, frame + phase, 0)
    }
  }
  return {
    enabled,
    dispose() {
      pass.update = update
      if (previousUniform) uniforms.sceneCloudCapture = previousUniform
      else delete uniforms.sceneCloudCapture
    }
  }
}

/** In live frames, opacity clips independently of lighting and motion relaxes
 * accumulation after the first Bayer cycle. Stills assemble exact samples.
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
    'uniform int frame;',
    `uniform int frame;
uniform bool sceneCloudCapture;
// Earlier capture phases contain exact samples of this pose. Preserve them
// until this pixel's own ray is available, even at a sharp opacity edge.
void resolveCapture(const ivec2 coord, const ivec2 sampleCoord, const bool fresh,
  out vec4 color, out float shadowLength) {
  color = fresh ? texelFetch(colorBuffer, sampleCoord, 0) : texelFetch(colorHistoryBuffer, coord, 0);
  #ifdef SHADOW_LENGTH
  shadowLength = fresh ? texelFetch(shadowLengthBuffer, sampleCoord, 0).r : texelFetch(shadowLengthHistoryBuffer, coord, 0).r;
  #endif
}`,
    'scene cloud resolve',
    'capture declaration'
  )
  shader = replaceExactlyOnce(
    shader,
    'temporalUpscale(coord, lowResCoord, currentFrame, outputColor, outputShadowLength);',
    `if (sceneCloudCapture) resolveCapture(coord, lowResCoord, currentFrame, outputColor, outputShadowLength);
  else temporalUpscale(coord, lowResCoord, currentFrame, outputColor, outputShadowLength);`,
    'scene cloud resolve',
    'sparse capture'
  )
  shader = replaceExactlyOnce(
    shader,
    'temporalAntialiasing(coord, outputColor, outputShadowLength);',
    `if (sceneCloudCapture) resolveCapture(coord, coord, true, outputColor, outputShadowLength);
  else temporalAntialiasing(coord, outputColor, outputShadowLength);`,
    'scene cloud resolve',
    'dense capture'
  )
  shader = replaceExactlyOnce(
    shader,
    /vec4 getClosestFragment\(const ivec2 coord\) \{[^]*?\n\}/g,
    `vec4 getClosestFragment(const ivec2 coord) {
  // Seed from the first sample, preserving tie order without a distance ceiling.
  // Giant cloud hits and clear-sky depths can exceed the old 1e7 metre sentinel.
  // texelFetch ignores texture wrapping; clamp explicitly at viewport edges.
  ivec2 maxCoord = textureSize(depthVelocityBuffer, 0) - ivec2(1);
  vec4 result = texelFetch(depthVelocityBuffer, clamp(coord + neighborOffsets[0], ivec2(0), maxCoord), 0);
  vec4 neighbor;
  #pragma unroll_loop_start
  for (int i = 1; i < 9; i++) {
    neighbor = texelFetch(depthVelocityBuffer, clamp(coord + neighborOffsets[i], ivec2(0), maxCoord), 0);
    if (neighbor.r < result.r) {
      result = neighbor;
    }
  }
  #pragma unroll_loop_end
  return result;
}`,
    'scene cloud resolve',
    'unbounded closest depth'
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
