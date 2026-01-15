import { AdditiveBlending } from 'three'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { GalaxyShader } from '@/core/materials/shaders/GalaxyShader'

class GalaxyMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new GalaxyShader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.blending = AdditiveBlending
    this.vertexColors = true
    this.depthWrite = false
  }

  public updateMaterial(): void {}

  public resetMaterial(): void {}
}

export { GalaxyMaterial }
