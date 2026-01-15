import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { DoubleSide } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import { RingShader } from '@/core/materials/shaders/RingShader'

class RingMaterial extends AbstractShaderMaterial {
  public model: Actor

  public constructor(model: Actor, parameters?: ShaderMaterialParameters) {
    super(parameters)
    this.model = model

    const { uniforms, vertexShader, fragmentShader } = new RingShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.side = DoubleSide
    this.transparent = true
    this.depthWrite = false
  }

  public updateMaterial(): void {}

  public resetMaterial(): void {}
}

export { RingMaterial }
