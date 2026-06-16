import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { PlanetShaderTemplate as Shader } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Texture, Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { IPlanetRenderingObject, IRingRenderingObject, ValueOf } from '@/core/models/types'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'

interface PlanetUniforms {
  lightPosition: Vector3
  diffuseMap: Texture | null
  nightMap: Texture | null
  cloudMap: Texture | null
  specularMap: Texture | null
  bumpMap: Texture | null
  bumpScale: number
  emission: number
  targetRadius: number
  shadowRingsInnerRadius: number
  shadowRingsOuterRadius: number
  shadowRingsTexture: Texture | null
}

class PlanetShader extends AbstractShader<keyof PlanetUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    const planetData: Record<
      keyof IPlanetRenderingObject,
      ValueOf<IPlanetRenderingObject>
    > = this.model.renderingObject?.getAttribute('data') || { bumpScale: 0, emission: 1 }

    const ringData: Record<keyof IRingRenderingObject, ValueOf<IRingRenderingObject>> = this.model.children
      .where('categoryId', 6)
      .first()
      ?.renderingObject?.getAttribute('data') || { innerRadius: 0, outerRadius: 0, alphaTest: 0, countParticles: 0 }
    const ringMap: Texture = resourceStorage.getTextureOrMake(
      this.model.children.where('categoryId', 6).first()?.resources.first()?.getAttribute('path')
    )

    const USE_RING: boolean = this.model.children.where('categoryId', 6).isNotEmpty()

    this.uniforms = {
      lightPosition: new Uniform(new Vector3()),
      diffuseMap: new Uniform(resourceStorage.getTextureOrMake('default.png')),
      nightMap: new Uniform(resourceStorage.getTextureOrMake('night.jpg')),
      cloudMap: new Uniform(null),
      specularMap: new Uniform(null),
      bumpMap: new Uniform(null),
      bumpScale: new Uniform(planetData.bumpScale),
      emission: new Uniform(planetData.emission),
      targetRadius: new Uniform(toThreeJSUnits(this.model.physicalObject?.getAttribute('radius', 1))),
      shadowRingsInnerRadius: new Uniform(toThreeJSUnits(ringData.innerRadius)),
      shadowRingsOuterRadius: new Uniform(toThreeJSUnits(ringData.outerRadius)),
      shadowRingsTexture: new Uniform(ringMap)
    }
    this.defines = {
      ...(USE_RING && { USE_RING: '1' })
    }
    this.name = 'PlanetShader'
  }
}

export { PlanetShader }
