import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Texture, Uniform } from 'three'
import { StarfieldShaderTemplate as Shader } from '@/core/materials/shaders/lib/StarfieldShaderTemplate'
import { getTextureByKey } from '@/config/textures'

interface StarfieldUniforms {
  time: number
  starTexture: Texture | null
}

class StarfieldShader extends AbstractShader<keyof StarfieldUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      time: new Uniform(0),
      starTexture: new Uniform(getTextureByKey('star.png'))
    }
    this.name = 'StarfieldShader'
  }
}

export { StarfieldShader }
