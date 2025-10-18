import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { BlackHoleDistortionShaderTemplate as Shader } from '@/core/materials/shaders/lib/BlackHole/V2/BlackHoleDistortionShaderTemplate'
import { Uniform, Vector2, Vector3 } from 'three'

interface BlackHoleDistortionUniforms {}

class BlackHoleDistortionShader extends AbstractShader<keyof BlackHoleDistortionUniforms> {
  public constructor() {
    super(Shader)

    this.uniforms = {
      resolution: new Uniform(new Vector2(window.innerWidth, window.innerHeight)),
      cameraWorldPosition: new Uniform(new Vector3()),
      centerPosition: new Uniform(new Vector3()),
      simulationRadius: new Uniform(10),
      blackHoleMass: new Uniform(0.1),
      innerAccretionDiskRadius: new Uniform(2.5),
      outerAccretionDiskRadius: new Uniform(8),
      accretionDiskHeight: new Uniform(1),
      steps: new Uniform(250),
      stepSize: new Uniform(0.7),
      starMap: new Uniform(null),
      noiseTexture: new Uniform(null)
    }
    this.name = 'BlackHoleDistortionShader'
  }
}

export { BlackHoleDistortionShader }
