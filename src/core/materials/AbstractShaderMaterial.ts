import { ShaderMaterial } from 'three'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'

abstract class AbstractShaderMaterial extends ShaderMaterial {
  protected constructor(parameters?: ShaderMaterialParameters) {
    super(parameters)
  }

  public abstract updateMaterial(): void
  public abstract resetMaterial(): void
}

export { AbstractShaderMaterial }
