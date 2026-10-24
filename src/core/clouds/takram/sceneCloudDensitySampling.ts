import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** The scene backend owns single-level shape volumes with identical linear
 * min/mag filters. Explicit LOD avoids gradient-dependent sampling in nested
 * marches without changing their texels, filtering or sample budget. */
export function adaptSceneCloudDensitySampling(source: string): string {
  let shader = source
  for (const [sampler, position] of [
    ['shapeTexture', 'shapePosition'],
    ['shapeDetailTexture', 'detailPosition']
  ])
    shader = replaceExactlyOnce(
      shader,
      `texture(${sampler}, ${position}).r`,
      `textureLod(${sampler}, ${position}, 0.0).r`,
      'scene cloud density sampling',
      sampler
    )

  // Normalized R8 detail and validated erosion strengths in [0, 1] cannot add
  // density to an empty coarse sample. Keep distance LOD and later profile /
  // normalization arithmetic intact; even faint nonzero channels still sample.
  shader = replaceExactlyOnce(
    shader,
    '  if (mipLevel * 0.5 + (jitter - 0.5) * 0.5 < 0.5) {',
    '  if (mipLevel * 0.5 + (jitter - 0.5) * 0.5 < 0.5 && !all(equal(density, vec4(0.0)))) {',
    'scene cloud density sampling',
    'empty detail sample'
  )

  // Keep invalid rays out of density sampling and temporal history. On ANGLE/D3D
  // a live isnan also requests IEEE-strict compilation, stabilizing the planetary
  // arithmetic across the implicit/explicit texture instruction variants.
  return replaceExactlyOnce(
    shader,
    '  bool intersectsGround = any(lessThan(rayNearFar, vec2(0.0)));',
    `  if (any(isnan(rayNearFar))) {
    outputColor = vec4(0.0);
    outputDepthVelocity = vec3(0.0);
    #ifdef SHADOW_LENGTH
    outputShadowLength = 0.0;
    #endif
    return;
  }
  bool intersectsGround = any(lessThan(rayNearFar, vec2(0.0)));`,
    'scene cloud density sampling',
    'ray interval'
  )
}
