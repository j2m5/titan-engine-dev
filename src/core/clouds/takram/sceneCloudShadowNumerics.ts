import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** Keep NaN ray intervals out of shadow history. A live isnan check also makes
 * ANGLE/D3D compile this kernel with IEEE strictness. At planetary coordinates its
 * separately linked programs otherwise produced different shadow results
 * from identical inputs. Keep the check in the shared cascade, before packing.
 */
export function adaptSceneCloudShadowNumerics(source: string): string {
  const anchor = 'vec3 rayOrigin = rayNear * rayDirection + sunPosition;'
  return replaceExactlyOnce(
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
}
