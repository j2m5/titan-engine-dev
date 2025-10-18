import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { BlackHoleDistortionMaskShader } from '@/core/materials/shaders/BlackHole/BlackHoleDistortionMaskShader'
import { DoubleSide } from 'three'

class BlackHoleDistortionMaskMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { vertexShader, fragmentShader } = new BlackHoleDistortionMaskShader()

    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.side = DoubleSide
    this.transparent = true
  }

  public updateMaterial(): void {}
}

export { BlackHoleDistortionMaskMaterial }
