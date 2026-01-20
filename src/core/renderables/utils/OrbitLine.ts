import { IRenderable } from '@/core/renderables/IRenderable'
import { Actor } from '@/core/models/Actor'
import { BufferGeometry, Line, LineBasicMaterial, Object3D, Vector3 } from 'three'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { timeStore } from '@/ui/mobx/TimeStore'
import { AU, SpaceScale } from '@/core/constants'

class OrbitLine implements IRenderable {
  private readonly model: Actor
  public geometry: BufferGeometry
  public material: LineBasicMaterial
  public object3D: Object3D

  public constructor(model: Actor) {
    this.model = model
    this.geometry = new BufferGeometry().setFromPoints(this.calculatePath())
    this.material = new LineBasicMaterial({ color: this.model.getAttribute('color'), transparent: true })
    this.object3D = new Line(this.geometry, this.material)
  }

  public build(): Object3D {
    this.object3D.name = this.model.getAttribute('name') + 'Orbit'
    this.object3D.scale.multiplyScalar(AU * SpaceScale)

    return this.object3D
  }

  public update(delta?: number): void {}

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
