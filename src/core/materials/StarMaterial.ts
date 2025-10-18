import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor.ts'
import { StarShader } from '@/core/materials/shaders/StarShader.ts'

class StarMaterial extends AbstractShaderMaterial {
  public model: Actor

  public constructor(model: Actor, parameters?: ShaderMaterialParameters) {
    super(parameters)
    this.model = model

    const { uniforms, vertexShader, fragmentShader } = new StarShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
  }

  public updateMaterial(): void {}
}

export { StarMaterial }
