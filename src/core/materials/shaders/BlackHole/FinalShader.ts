import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { FinalShaderTemplate as Shader } from '@/core/materials/shaders/lib/BlackHole/FinalShaderTemplate'
import { Texture, Uniform, Vector2 } from 'three'

interface FinalUniforms {
  spaceTexture: Texture | null
  distortionTexture: Texture | null
  blackHolePosition: Vector2
  rgbShiftRadius: number
}

class FinalShader extends AbstractShader<keyof FinalUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      spaceTexture: new Uniform(null),
      distortionTexture: new Uniform(null),
      blackHolePosition: new Uniform(new Vector2()),
      rgbShiftRadius: new Uniform(0.00001)
    }
    this.name = 'FinalShader'
  }
}

export { FinalShader }
