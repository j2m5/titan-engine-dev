import { AbstractShader } from '@/core/materials/shaders/AbstractShader.ts'
import { Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor.ts'
import { AtmosphereShaderTemplate as Shader } from '@/core/materials/shaders/lib/AtmosphereShaderTemplate.ts'
import { toThreeJSUnits } from '@/core/helpers/scaling.ts'
import { Colorable, IAtmosphereRenderingObject, ValueOf } from '@/core/models/types.ts'
import { calculateScatterRGB } from '@/core/materials/helpers.ts'

interface AtmosphereUniforms {
  targetRadius: number
  atmosphereRadius: number
  lightPosition: Vector3
  scatterRGB: Vector3
  densityFalloff: number
}

class AtmosphereShader extends AbstractShader<keyof AtmosphereUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    const parent: Actor = this.model.parent

    const atmosphereData: Record<
      keyof IAtmosphereRenderingObject,
      ValueOf<IAtmosphereRenderingObject>
    > = this.model.renderingObject.getAttribute('data')

    const scatter: Colorable = calculateScatterRGB(
      atmosphereData.scatter as Colorable,
      atmosphereData.scatteringStrength as number
    )

    this.uniforms = {
      targetRadius: new Uniform(toThreeJSUnits(parent.physicalObject.getAttribute('radius', 1))),
      atmosphereRadius: new Uniform(toThreeJSUnits(atmosphereData.radius as number)),
      lightPosition: new Uniform(new Vector3()),
      scatterRGB: new Uniform(scatter),
      densityFalloff: new Uniform(atmosphereData.densityFalloff)
    }
    this.name = 'AtmosphereShader'
  }
}

export { AtmosphereShader }
