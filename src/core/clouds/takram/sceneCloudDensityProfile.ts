import type { CloudLayers } from '@takram/three-clouds'
import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** Scene layer profiles are fixed for an effect's lifetime. Select the linear
 * formula once on the CPU; nonlinear profiles retain the full upstream formula. */
export function adaptSceneCloudDensityProfile(source: string, layers: CloudLayers): string {
  if (layers.some(({ densityProfile }) => densityProfile.expTerm !== 0 || densityProfile.exponent !== 0)) return source

  return replaceExactlyOnce(
    source,
    `return densityProfile.expTerms * exp(densityProfile.exponents * heightFraction) +
    densityProfile.linearTerms * heightFraction +
    densityProfile.constantTerms;`,
    'return densityProfile.linearTerms * heightFraction + densityProfile.constantTerms;',
    'scene cloud density profile',
    'linear formula'
  )
}
