import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { BlackHoleDistortionActiveShader } from '@/core/materials/shaders/BlackHole/BlackHoleDistortionActiveShader'
import { DoubleSide } from 'three'

class BlackHoleDistortionActiveMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { vertexShader, fragmentShader } = new BlackHoleDistortionActiveShader()

    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.side = DoubleSide
    this.transparent = true
  }

  public updateMaterial(): void {}
}

export { BlackHoleDistortionActiveMaterial }
