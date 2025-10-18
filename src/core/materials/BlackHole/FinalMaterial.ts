import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { FinalShader } from '@/core/materials/shaders/BlackHole/FinalShader'

class FinalMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new FinalShader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.depthWrite = false
    this.depthTest = false
  }

  public updateMaterial(): void {}
}

export { FinalMaterial }
