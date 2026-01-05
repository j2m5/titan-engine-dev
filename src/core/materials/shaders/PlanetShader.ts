import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { PlanetShaderTemplate as Shader } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Texture, Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { getTextureByKeyWithDefault } from '@/config/textures'
import { IAtmosphereRenderingObject, IPlanetRenderingObject, IRingRenderingObject, ValueOf } from '@/core/models/types'
import { toThreeJSUnits } from '@/core/helpers/scaling'

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
  atmosphereRadius: number
  scatterRGB: Vector3
  densityFalloff: number
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

    const atmosphereData: Record<
      keyof IAtmosphereRenderingObject,
      ValueOf<IAtmosphereRenderingObject>
    > = this.model.children.where('categoryId', 8).first()?.renderingObject.getAttribute('data') || {
      radius: 0,
      scatter: { r: 0, g: 0, b: 0 },
      scatteringStrength: 0,
      densityFalloff: 0
    }

    const USE_ATMOSPHERE: boolean = this.model.children.where('categoryId', 8).isNotEmpty()

    const ringData: Record<keyof IRingRenderingObject, ValueOf<IRingRenderingObject>> = this.model.children
      .where('categoryId', 10)
      .first()
      ?.renderingObject.getAttribute('data') || { innerRadius: 0, outerRadius: 0, alphaTest: 0, countParticles: 0 }
    const ringMap: Texture = getTextureByKeyWithDefault(
      this.model.children.where('categoryId', 10).first()?.resources.first()?.getAttribute('path')
    )

    const USE_RING: boolean = this.model.children.where('categoryId', 10).isNotEmpty()

    this.uniforms = {
      lightPosition: new Uniform(new Vector3()),
      diffuseMap: new Uniform(getTextureByKeyWithDefault('default.png')),
      nightMap: new Uniform(getTextureByKeyWithDefault('night.jpg')),
      cloudMap: new Uniform(null),
      specularMap: new Uniform(null),
      bumpMap: new Uniform(null),
      bumpScale: new Uniform(planetData.bumpScale),
      emission: new Uniform(planetData.emission),
      targetRadius: new Uniform(toThreeJSUnits(this.model.physicalObject.getAttribute('radius', 1))),
      atmosphereRadius: new Uniform(toThreeJSUnits(atmosphereData.radius as number)),
      scatterRGB: new Uniform(atmosphereData.scatter),
      densityFalloff: new Uniform(atmosphereData.densityFalloff),
      shadowRingsInnerRadius: new Uniform(toThreeJSUnits(ringData.innerRadius)),
      shadowRingsOuterRadius: new Uniform(toThreeJSUnits(ringData.outerRadius)),
      shadowRingsTexture: new Uniform(ringMap)
    }
    this.defines = {
      ...(USE_ATMOSPHERE && { USE_ATMOSPHERE: '1' }),
      ...(USE_RING && { USE_RING: '1' })
    }
    this.name = 'PlanetShader'
  }
}

export { PlanetShader }
