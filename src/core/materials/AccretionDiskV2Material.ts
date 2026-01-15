import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AccretionDiskV2Shader } from '@/core/materials/shaders/AccretionDiskV2Shader'
import { AdditiveBlending, DoubleSide } from 'three'

class AccretionDiskV2Material extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new AccretionDiskV2Shader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.side = DoubleSide
    this.blending = AdditiveBlending
    this.transparent = true
    this.depthWrite = false
  }

  public updateMaterial(): void {}

  public resetMaterial(): void {}
}

export { AccretionDiskV2Material }
