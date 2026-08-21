import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { Texture, Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { RingShaderTemplate as Shader } from '@/core/materials/shaders/lib/RingShaderTemplate'
import { IRingRenderingObject } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { config } from '@/core/framework/config'

interface RingUniforms {
  diffuseMap: Texture | null
  innerRadius: number
  outerRadius: number
  alphaTest: number
  lightPosition: Vector3
  planetRadius: number
  minDistance: number
  maxDistance: number
  /** Непрозрачность кольца на ребре (тюнить визуально) */
  ringEdgeOpacity: number
  /** Круче → быстрее гаснет к ребру */
  ringAngleCurve: number
  uRingForwardScattering: number
  uRingOppositionSurge: number
  uRingDensityExtinction: number
}

class RingShader extends AbstractShader<keyof RingUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    const parent: Actor = this.model.parent!

    // Форма `renderingObject.data` утверждается локально, где категория известна
    const ringData: IRingRenderingObject = requireRenderingData<IRingRenderingObject>(this.model, 'RingShader')

    const ringTexture: Texture = resourceStorage.getTextureOrMake(
      this.model.resources.first()?.getAttribute('path') ?? ''
    )

    this.uniforms = {
      diffuseMap: new Uniform(ringTexture),
      innerRadius: new Uniform(toThreeJSUnits(ringData.innerRadius)),
      outerRadius: new Uniform(toThreeJSUnits(ringData.outerRadius)),
      alphaTest: new Uniform(ringData.alphaTest),
      lightPosition: new Uniform(new Vector3()),
      planetRadius: new Uniform(toThreeJSUnits(parent.physicalObject?.getAttribute('radius', 1) ?? 1)),
      minDistance: new Uniform(toThreeJSUnits(1000)),
      maxDistance: new Uniform(toThreeJSUnits(5000)),
      ringEdgeOpacity: new Uniform(0.1),
      ringAngleCurve: new Uniform(1.5),
      uRingForwardScattering: new Uniform(config('ring.forwardScattering')),
      uRingOppositionSurge: new Uniform(config('ring.oppositionSurge')),
      uRingDensityExtinction: new Uniform(config('ring.densityExtinction'))
    }
    this.name = 'RingShader'
  }
}

export { RingShader }
