import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import type { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { SchwarzschildLensingShader } from '@/core/materials/shaders/BlackHole/V2/SchwarzschildLensingShader'

class SchwarzschildLensingMaterial extends AbstractShaderMaterial {
  public constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new SchwarzschildLensingShader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.depthWrite = false
    this.depthTest = false
    this.transparent = false
  }

  public updateMaterial(): void {}
}

export { SchwarzschildLensingMaterial }
