import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AccretionDiskShader } from '@/core/materials/shaders/BlackHole/AccretionDiskShader'
import { AdditiveBlending, DoubleSide } from 'three'

class AccretionDiskMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new AccretionDiskShader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.side = DoubleSide
    this.blending = AdditiveBlending
    this.depthWrite = false
    this.depthTest = false
    this.transparent = true
  }

  public updateMaterial(): void {}
}

export { AccretionDiskMaterial }
