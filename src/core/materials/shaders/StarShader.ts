import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { StarShaderTemplate as Shader } from '@/core/materials/shaders/lib/StarShaderTemplate'
import { buildStarPalette, StarPalette } from '@/core/materials/shaders/lib/helpers'
import { Colorable } from '@/core/models/types'

interface StarUniforms {
  spectralColor: Colorable
  uColorCool: Colorable
  uColorHot: Colorable
  uCoreIntensity: number
  uLimbCoeff: Vector3
  time: number
}

class StarShader extends AbstractShader<keyof StarUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    const temperature: number = this.model.physicalObject?.getAttribute('temperature', 3000) ?? 3000
    const palette: StarPalette = buildStarPalette(temperature)

    this.uniforms = {
      spectralColor: new Uniform(palette.base),
      uColorCool: new Uniform(palette.cool),
      uColorHot: new Uniform(palette.hot),
      uCoreIntensity: new Uniform(4.0),
      uLimbCoeff: new Uniform(new Vector3(0.5, 0.65, 0.8)),
      time: new Uniform(0)
    }
    this.name = 'StarShader'
  }
}

export { StarShader }
