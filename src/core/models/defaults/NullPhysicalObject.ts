import { IPhysicalObject } from '@/core/models/types'
import { MoonMass } from '@/core/constants'
import { randInt } from 'three/src/math/MathUtils'

class NullPhysicalObject implements IPhysicalObject {
  public readonly id: number
  public readonly actorId: number
  public readonly parentId: number | null
  public mass: number
  public radius: number
  public axialTilt: number
  public orbitalPeriod: number
  public rotationPeriod: number
  public temperature: number

  public constructor(actorId: number) {
    this.id = randInt(10000, 100000)
    this.actorId = actorId
    this.parentId = null
    this.mass = MoonMass / 10
    this.radius = 1000
    this.axialTilt = 0
    this.orbitalPeriod = 10
    this.rotationPeriod = 10
    this.temperature = 0
  }
}

export { NullPhysicalObject }
