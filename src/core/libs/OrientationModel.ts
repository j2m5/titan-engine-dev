import { TOrientationModel } from '@/core/models/types'
import { Actor } from '@/core/models/Actor.ts'
import { degToRad } from 'three/src/math/MathUtils'
import { Quaternion, Vector3 } from 'three'

const SECONDS_PER_HOUR: number = 3600

class OrientationModel implements TOrientationModel {
  private readonly model: Actor

  public constructor(model: Actor) {
    this.model = model
  }

  public get meridianAngle(): number {
    return this.model.rotation?.getAttribute('meridianAngle', 0)
  }

  public get __meridianAngle(): number {
    return degToRad(this.meridianAngle)
  }

  public get ascendingNode(): number {
    return this.model.rotation?.getAttribute('ascendingNode', 0)
  }

  public get __ascendingNode(): number {
    return degToRad(this.ascendingNode)
  }

  public get inclination(): number {
    return this.model.rotation?.getAttribute('inclination', 0)
  }

  public get __inclination(): number {
    return degToRad(this.inclination)
  }

  public get period(): number {
    return this.model.rotation?.getAttribute('period', 0)
  }

  public get __period(): number {
    return this.period * SECONDS_PER_HOUR
  }

  public getQuaternion(seconds: number): Quaternion {
    const axialTilt: Quaternion = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.__inclination)
    const orientation: Quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.__ascendingNode)
    const rotationPhase: number = this.__meridianAngle + (seconds / this.__period) * 360
    const spin: Quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), degToRad(rotationPhase))

    return orientation.clone().multiply(axialTilt).multiply(spin)
  }
}

export { OrientationModel }
