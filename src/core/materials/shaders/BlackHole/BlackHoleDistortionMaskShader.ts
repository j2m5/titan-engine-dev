import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { BlackHoleDistortionMaskShaderTemplate as Shader } from '@/core/materials/shaders/lib/BlackHole/BlackHoleDistortionMaskShaderTemplate'

class BlackHoleDistortionMaskShader extends AbstractShader {
  public constructor() {
    super(Shader)

    this.name = 'BlackHoleDistortionMaskShader'
  }
}

export { BlackHoleDistortionMaskShader }
