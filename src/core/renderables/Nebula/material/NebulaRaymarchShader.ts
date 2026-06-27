import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { NebulaRaymarchShaderTemplate, createNebulaUniforms } from './shader/raymarch.template'

class NebulaRaymarchShader extends AbstractShader {
  public constructor() {
    super(NebulaRaymarchShaderTemplate)
    // Rebuild uniforms per instance so materials never share Uniform objects
    // (the template's set is a single module-level instance). Mirrors StarShader.
    this.uniforms = createNebulaUniforms()
  }
}

export { NebulaRaymarchShader }
