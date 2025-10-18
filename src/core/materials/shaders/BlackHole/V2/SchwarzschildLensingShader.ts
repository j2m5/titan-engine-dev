import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { SchwarzschildLensingShaderTemplate as Shader } from '@/core/materials/shaders/lib/BlackHole/V2/SchwarzschildLensingShaderTemplate'
import { Uniform, Vector2, Vector3 } from 'three'

interface SchwarzschildLensingUniforms {
  uResolution: Vector2
  uCameraPosition: Vector3
  uRotation: Vector3
  uMaxIterations: number
  uStepSize: number
  uDiskInnerRadius: number
  uDiskOuterRadius: number
  uDiskTemperature: number
  uColorScale: number
}

class SchwarzschildLensingShader extends AbstractShader<keyof SchwarzschildLensingUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      uResolution: new Uniform(new Vector2(window.innerWidth, window.innerHeight)),
      uCameraPosition: new Uniform(new Vector3()),
      uRotation: new Uniform(new Vector3()),
      uMaxIterations: new Uniform(100),
      uStepSize: new Uniform(0.07),
      uDiskInnerRadius: new Uniform(2),
      uDiskOuterRadius: new Uniform(70),
      uDiskTemperature: new Uniform(4500),
      uColorScale: new Uniform(1)
    }
    this.name = 'SchwarzschildLensingShader'
  }
}

export { SchwarzschildLensingShader }
