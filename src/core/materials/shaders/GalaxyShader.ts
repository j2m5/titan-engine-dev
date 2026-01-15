import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Texture, Uniform } from 'three'
import { GalaxyShaderTemplate as Shader } from '@/core/materials/shaders/lib/GalaxyShaderTemplate'
import { resourceStorage } from '@/core/services/ResourceStorage'

interface GalaxyUniforms {
  map: Texture | null
  size: number
}

class GalaxyShader extends AbstractShader<keyof GalaxyUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      map: new Uniform(resourceStorage.getTexture('sun_glow.png')),
      size: new Uniform(0.1)
    }
    this.name = 'GalaxyShader'
  }
}

export { GalaxyShader }
