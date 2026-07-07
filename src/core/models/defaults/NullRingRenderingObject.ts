import { IRingRenderingObject } from '@/core/models/types'
import { randInt } from 'three/src/math/MathUtils'

class NullRingRenderingObject implements IRingRenderingObject {
  public readonly id: number
  public readonly actorId: number
  public innerRadius: number
  public outerRadius: number
  public alphaTest: number
  public asteroidDensityScale: number

  public constructor(actorId: number) {
    this.id = randInt(10000, 100000)
    this.actorId = actorId
    this.innerRadius = 0
    this.outerRadius = 0
    this.alphaTest = 0.02
    this.asteroidDensityScale = 1
  }
}

export { NullRingRenderingObject }
