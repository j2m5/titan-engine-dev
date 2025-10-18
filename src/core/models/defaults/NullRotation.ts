import { IRotationObject } from '@/core/models/types'
import { randInt } from 'three/src/math/MathUtils'

class NullRotation implements IRotationObject {
  public readonly id: number
  public readonly actorId: number
  public meridianAngle: number
  public ascendingNode: number
  public inclination: number
  public period: number

  public constructor(actorId: number) {
    this.id = randInt(10000, 100000)
    this.actorId = actorId
    this.meridianAngle = 0
    this.ascendingNode = 0
    this.inclination = 0
    this.period = 1
  }
}

export { NullRotation }
