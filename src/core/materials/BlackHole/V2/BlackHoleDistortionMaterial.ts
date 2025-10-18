import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { BlackHoleDistortionShader } from '@/core/materials/shaders/BlackHole/V2/BlackHoleDistortionShader'
import { NormalBlending } from 'three'

class BlackHoleDistortionMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new BlackHoleDistortionShader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.blending = NormalBlending
    this.transparent = false
    this.depthWrite = false
    this.depthTest = false
  }

  public updateMaterial(): void {}
}

export { BlackHoleDistortionMaterial }
