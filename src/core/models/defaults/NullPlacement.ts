import { IPlacement } from '@/core/models/types'
import { randInt } from 'three/src/math/MathUtils'

class NullPlacement implements IPlacement {
  public readonly id: number
  public readonly actorId: number
  public x: number
  public y: number
  public z: number

  public constructor(actorId: number) {
    this.id = randInt(10000, 100000)
    this.actorId = actorId
    this.x = 0
    this.y = 0
    this.z = 0
  }
}

export { NullPlacement }
