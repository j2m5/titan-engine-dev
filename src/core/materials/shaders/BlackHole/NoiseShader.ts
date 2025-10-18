import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { NoiseShaderTemplate as Shader } from '@/core/materials/shaders/lib/BlackHole/NoiseShaderTemplate'

class NoiseShader extends AbstractShader {
  public constructor() {
    super(Shader)

    this.name = 'NoiseShader'
  }
}

export { NoiseShader }
