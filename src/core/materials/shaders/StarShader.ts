import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { StarShaderTemplate as Shader } from '@/core/materials/shaders/lib/StarShaderTemplate'
import {
  buildStarPalette,
  DEFAULT_STAR_TEMPERATURE_K,
  STAR_CORE_INTENSITY,
  StarPalette
} from '@/core/materials/shaders/lib/helpers'
import { starActivityFor, starLimbCoeffFor } from '@/core/renderables/utils/starActivity'
import { Colorable } from '@/core/models/types'

interface StarUniforms {
  spectralColor: Colorable
  uColorCool: Colorable
  uColorHot: Colorable
  uCoreIntensity: number
  uLimbCoeff: Vector3
  /** Доля грануляции 0..1 — конвективная активность по температуре (см. starActivity) */
  uGranulation: number
  time: number
}

class StarShader extends AbstractShader<keyof StarUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    const temperature: number =
      this.model.physicalObject?.getAttribute('temperature', DEFAULT_STAR_TEMPERATURE_K) ?? DEFAULT_STAR_TEMPERATURE_K
    const palette: StarPalette = buildStarPalette(temperature)
    const activity: number = starActivityFor(this.model)

    this.uniforms = {
      spectralColor: new Uniform(palette.base),
      uColorCool: new Uniform(palette.cool),
      uColorHot: new Uniform(palette.hot),
      uCoreIntensity: new Uniform(STAR_CORE_INTENSITY),
      uLimbCoeff: new Uniform(new Vector3(...starLimbCoeffFor(this.model))),
      uGranulation: new Uniform(activity),
      time: new Uniform(0)
    }
    this.name = 'StarShader'
  }
}

export { StarShader }
