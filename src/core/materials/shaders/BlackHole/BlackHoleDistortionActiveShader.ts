import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { BlackHoleDistortionActiveShaderTemplate as Shader } from '@/core/materials/shaders/lib/BlackHole/BlackHoleDistortionActiveShaderTemplate'

class BlackHoleDistortionActiveShader extends AbstractShader {
  public constructor() {
    super(Shader)

    this.name = 'BlackHoleDistortionActiveShader'
  }
}

export { BlackHoleDistortionActiveShader }
