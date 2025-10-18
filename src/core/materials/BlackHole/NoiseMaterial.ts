import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { NoiseShader } from '@/core/materials/shaders/BlackHole/NoiseShader'

class NoiseMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { vertexShader, fragmentShader } = new NoiseShader()

    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
  }

  public updateMaterial(): void {}
}

export { NoiseMaterial }
