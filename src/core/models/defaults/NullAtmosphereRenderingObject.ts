import { Colorable, IAtmosphereRenderingObject } from '@/core/models/types'
import { randInt } from 'three/src/math/MathUtils'

class NullAtmosphereRenderingObject implements IAtmosphereRenderingObject {
  public readonly id: number
  public readonly actorId: number
  public radius: number
  public scatter: Colorable
  public scatteringStrength: number
  public densityFalloff: number

  public constructor(actorId: number) {
    this.id = randInt(10000, 100000)
    this.actorId = actorId
    this.radius = 0
    this.scatter = { r: 0, g: 0, b: 0 }
    this.scatteringStrength = 0
    this.densityFalloff = 0
  }
}

export { NullAtmosphereRenderingObject }
