import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial.ts'
import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader.ts'

class InstancedAsteroidMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new InstancedAsteroidShader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
  }

  public updateMaterial(): void {}
}

export { InstancedAsteroidMaterial }
