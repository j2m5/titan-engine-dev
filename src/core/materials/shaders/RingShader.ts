import { AbstractShader } from '@/core/materials/shaders/AbstractShader.ts'
import { Texture, Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor.ts'
import { RingShaderTemplate as Shader } from '@/core/materials/shaders/lib/RingShaderTemplate.ts'
import { IRingRenderingObject, ValueOf } from '@/core/models/types.ts'
import { getTextureByKeyWithDefault } from '@/config/textures.ts'
import { toThreeJSUnits } from '@/core/helpers/scaling.ts'

interface RingUniforms {
  diffuseMap: Texture | null
  innerRadius: number
  outerRadius: number
  alphaTest: number
  lightPosition: Vector3
  planetRadius: number
  minDistance: number
  maxDistance: number
}

class RingShader extends AbstractShader<keyof RingUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    const parent: Actor = this.model.parent

    const ringData: Record<
      keyof IRingRenderingObject,
      ValueOf<IRingRenderingObject>
    > = this.model.renderingObject.getAttribute('data')
    const ringTexture: Texture = getTextureByKeyWithDefault(this.model.resources.first()?.getAttribute('path'))

    this.uniforms = {
      diffuseMap: new Uniform(ringTexture),
      innerRadius: new Uniform(toThreeJSUnits(ringData.innerRadius)),
      outerRadius: new Uniform(toThreeJSUnits(ringData.outerRadius)),
      alphaTest: new Uniform(ringData.alphaTest),
      lightPosition: new Uniform(new Vector3()),
      planetRadius: new Uniform(toThreeJSUnits(parent.physicalObject.getAttribute('radius', 1))),
      minDistance: new Uniform(toThreeJSUnits(1000)),
      maxDistance: new Uniform(toThreeJSUnits(5000))
    }
    this.name = 'RingShader'
  }
}

export { RingShader }
