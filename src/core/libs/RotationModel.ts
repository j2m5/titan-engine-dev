import { Actor } from '@/core/models/Actor'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { degToRad } from 'three/src/math/MathUtils'
import { Quaternion, Vector3 } from 'three'
import { TRotationModel } from '@/core/models/types'

class RotationModel implements TRotationModel {
  private readonly epoch: number
  private readonly model: Actor
  private readonly keplerianModel: KeplerianModel

  public constructor(epoch: number, model: Actor, keplerianModel: KeplerianModel) {
    this.epoch = epoch
    this.model = model
    this.keplerianModel = keplerianModel
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

  public get direction(): 1 | -1 {
    return this.model.rotation.getAttribute('direction', 1)
  }

  public getOrientation(epoch: number): Quaternion {
    if (!this.period) {
      return new Quaternion()
    }

    const orbitalFrame: Quaternion = this.keplerianModel.getOrbitalFrameQuaternion()
    const axisOrientation: Quaternion = this.getAxisOrientation()
    const rotation: Quaternion = this.getCurrentRotation(epoch)

    const result: Quaternion = new Quaternion()
    result.multiply(orbitalFrame).multiply(axisOrientation).multiply(rotation)

    return result
  }

  public getRotationAxis(epoch: number): Vector3 {
    const orientation: Quaternion = this.getOrientation(epoch)

    return new Vector3(0, 1, 0).applyQuaternion(orientation).normalize()
  }

  private getAxisOrientation(): Quaternion {
    const nodeRotation: Quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.__ascendingNode)
    const inclinationRotation: Quaternion = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.__inclination)

    console.log(this.model.getAttribute('name'), inclinationRotation, this.__inclination)

    return nodeRotation.multiply(inclinationRotation)
  }

  private getCurrentRotation(epoch: number): Quaternion {
    const hoursElapsed: number = (epoch - this.epoch) / 3600
    const rotations: number = hoursElapsed / this.period
    const currentAngle: number = this.__meridianAngle + rotations * Math.PI * 2 * this.direction

    return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), currentAngle)
  }
}

export { RotationModel }
