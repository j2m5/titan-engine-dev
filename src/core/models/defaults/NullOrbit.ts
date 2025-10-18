import { IOrbit } from '@/core/models/types'
import { randInt } from 'three/src/math/MathUtils'

class NullOrbit implements IOrbit {
  public readonly id: number
  public readonly actorId: number
  public semiMajorAxis: number
  public eccentricity: number
  public inclination: number
  public argOfPeriapsis: number
  public ascendingNode: number
  public meanAnomalyAtEpoch: number

  public constructor(actorId: number) {
    this.id = randInt(10000, 100000)
    this.actorId = actorId
    this.semiMajorAxis = 0
    this.eccentricity = 0
    this.inclination = 0
    this.argOfPeriapsis = 0
    this.ascendingNode = 0
    this.meanAnomalyAtEpoch = 0
  }
}

export { NullOrbit }
