import { AbstractShader } from '@/core/materials/shaders/AbstractShader.ts'
import { Color, Uniform } from 'three'
import { Actor } from '@/core/models/Actor.ts'
import { StarShaderTemplate as Shader } from '@/core/materials/shaders/lib/StarShaderTemplate.ts'
import { colorTemperatureToRGB, normalizeColor } from '@/core/materials/shaders/lib/helpers.ts'

interface StarUniforms {
  spectralColor: Color
  time: number
}

class StarShader extends AbstractShader<keyof StarUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    const temperature: number = this.model.physicalObject.getAttribute('temperature', 3000)
    const { r, g, b } = colorTemperatureToRGB(temperature)

    this.uniforms = {
      spectralColor: new Uniform(normalizeColor({ r, g, b })),
      time: new Uniform(0)
    }
    this.name = 'StarShader'
  }
}

export { StarShader }
