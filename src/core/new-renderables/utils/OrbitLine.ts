import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { AU, SpaceScale } from '@/core/constants'
import { timeStore } from '@/ui/mobx/TimeStore'

class OrbitLine extends Line {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: LineBasicMaterial

  public constructor(model: Actor) {
    super()
    this.model = model
    this.name = this.model.getAttribute('name') + 'OrbitLine'

    this.__setup()
  }

  __setup(): void {
    this.geometry = new BufferGeometry().setFromPoints(this.calculatePath())
    this.material = new LineBasicMaterial({ color: this.model.getAttribute('color') })

    this.scale.multiplyScalar(AU * SpaceScale)
  }

  private calculatePath(segments: number = 3600): Vector3[] {
    const points: Vector3[] = []
    const keplerianModel: KeplerianModel = new KeplerianModel(timeStore.epoch, this.model)

    if (!keplerianModel.semiMajorAxis) {
      return points
    }

    for (let i: number = 0; i <= segments; i++) {
      const trueAnomaly: number = (i / segments) * Math.PI * 2
      const localPos: Vector3 = keplerianModel.getOwnCoordsByTrueAnomaly(trueAnomaly)
      const worldPos: Vector3 = localPos.applyQuaternion(keplerianModel.getOrbitalFrameQuaternion())

      points.push(worldPos)
    }

    return points
  }
}

export { OrbitLine }
