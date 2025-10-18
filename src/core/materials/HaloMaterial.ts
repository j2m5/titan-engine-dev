import { AdditiveBlending, BackSide } from 'three'
import { Actor } from '@/core/models/Actor.ts'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial.ts'
import { HaloShader } from '@/core/materials/shaders/HaloShader.ts'

class HaloMaterial extends AbstractShaderMaterial {
  public model: Actor

  public constructor(model: Actor, parameters?: ShaderMaterialParameters) {
    super(parameters)
    this.model = model

    const { uniforms, vertexShader, fragmentShader } = new HaloShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.depthWrite = false
    this.transparent = true
    this.blending = AdditiveBlending
    this.side = BackSide
  }

  public updateMaterial(): void {}
}

export { HaloMaterial }
