import { AdditiveBlending } from 'three'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { StarfieldShader } from '@/core/materials/shaders/StarfieldShader'

class StarfieldMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new StarfieldShader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.vertexColors = true
    this.blending = AdditiveBlending
  }

  public updateMaterial(): void {}

  public resetMaterial(): void {}
}

export { StarfieldMaterial }
