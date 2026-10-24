import type { CloudsEffect } from '@takram/three-clouds'
import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** The private scene effect keeps its weather parameters for its lifetime.
 * With no offset or velocity, radial evolution contributes zero to every
 * density sample. Moving or already displaced weather retains the full formula.
 * Changing specialized weather parameters later requires effect recreation. */
export function adaptSceneCloudStationaryWeather(
  source: string,
  {
    localWeatherOffset: offset,
    localWeatherVelocity: velocity
  }: Pick<CloudsEffect, 'localWeatherOffset' | 'localWeatherVelocity'>
): string {
  if (offset.x !== 0 || offset.y !== 0 || velocity.x !== 0 || velocity.y !== 0) return source

  return replaceExactlyOnce(
    source,
    `  vec3 surfaceNormal = normalize(position);
  float localWeatherSpeed = length(localWeatherOffset);
  vec3 evolution = -surfaceNormal * localWeatherSpeed * 2e4;`,
    '  vec3 evolution = vec3(0.0);',
    'scene cloud stationary weather',
    'radial evolution'
  )
}
