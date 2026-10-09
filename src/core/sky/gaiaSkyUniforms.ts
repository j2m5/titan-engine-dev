import { CubeTexture, Matrix3, Uniform } from 'three'
import { config } from '@/core/framework/config'
import { SCENE_TO_GALACTIC } from '@/core/sky/galacticFrame'
import { GAIA_LEVELS } from '@/core/sky/gaiaTiles'

/** Юниформы неба Gaia; имена = объявления чанка SkySample */
export interface GaiaSkyUniforms {
  uGaiaGalaxy: Uniform<CubeTexture | null>
  uGaiaStars: Uniform<CubeTexture | null>
  uGaiaStarsCoarse: Uniform<CubeTexture | null>
  uGaiaOrientation: Uniform<Matrix3>
  /** Наименьший полностью загруженный уровень; GAIA_LEVELS — ничего */
  uGaiaMinLod: Uniform<number>
  uGaiaExposure: Uniform<number>
  uGaiaStarCeiling: Uniform<number>
}

export function createGaiaSkyUniforms(): GaiaSkyUniforms {
  return {
    uGaiaGalaxy: new Uniform<CubeTexture | null>(null),
    uGaiaStars: new Uniform<CubeTexture | null>(null),
    uGaiaStarsCoarse: new Uniform<CubeTexture | null>(null),
    uGaiaOrientation: new Uniform(SCENE_TO_GALACTIC.clone()),
    uGaiaMinLod: new Uniform(GAIA_LEVELS),
    uGaiaExposure: new Uniform(2 ** config('background.gaia.exposureStops')),
    uGaiaStarCeiling: new Uniform(config('background.gaia.starCeiling'))
  }
}

/**
 * Общий набор приложения: все места чтения фона ссылаются на эти экземпляры,
 * GaiaSky пишет в них текстуры и уровень загрузки
 */
export const gaiaSkyUniforms: GaiaSkyUniforms = createGaiaSkyUniforms()
