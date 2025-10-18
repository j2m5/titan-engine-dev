import { AbstractShader } from '@/core/materials/shaders/AbstractShader.ts'
import { Texture, Uniform } from 'three'
import { GalaxyShaderTemplate as Shader } from '@/core/materials/shaders/lib/GalaxyShaderTemplate.ts'
import { getTextureByKey } from '@/config/textures.ts'

interface GalaxyUniforms {
  map: Texture | null
  size: number
}

class GalaxyShader extends AbstractShader<keyof GalaxyUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      map: new Uniform(getTextureByKey('sun_glow.png')),
      size: new Uniform(0.1)
    }
    this.name = 'GalaxyShader'
  }
}

export { GalaxyShader }
