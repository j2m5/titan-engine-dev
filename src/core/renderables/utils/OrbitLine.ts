import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { AU, SpaceScale } from '@/core/constants'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { OVERLAY_LAYER } from '@/core/graphic/passes/DepthVolume'

/** Display an open hyperbola out to 100 times the larger of |a| and periapsis. */
const HYPERBOLA_EXTENT_SCALE = 100

class OrbitLine extends Line implements Acceptable<IObject3DVisitor> {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: LineBasicMaterial

  public constructor(model: Actor) {
    super()
    this.model = model
    this.name = this.model.getAttribute('name', '') + 'OrbitLine'

    this.__setup()
  }

  __setup(): void {
    this.geometry = new BufferGeometry().setFromPoints(this.calculatePath())
    this.material = new LineBasicMaterial({ color: this.model.getAttribute('color', '#ffffff'), depthTest: false })

    this.userData.type = 'orbit'
    // Поверх лензированного кадра (OverlayPass): линии орбит линзы не искривляют
    this.layers.set(OVERLAY_LAYER)
    this.scale.multiplyScalar(AU * SpaceScale)
  }

  private calculatePath(segments: number = 3600): Vector3[] {
    const points: Vector3[] = []
    const keplerianModel: KeplerianModel = new KeplerianModel(this.model)

    if (!keplerianModel.semiMajorAxis) {
      return points
    }

    const frame = keplerianModel.getOrbitalFrameQuaternion()
    if (keplerianModel.isHyperbolic) {
      const a = -keplerianModel.semiMajorAxis
      const e = keplerianModel.eccentricity
      const periapsis = a * (e - 1)
      const minorAxis = a * Math.sqrt(e - 1) * Math.sqrt(e + 1)
      // r = |a| * (e*cosh(H) - 1). Bounded H samples one physical branch
      // without crossing either asymptote or joining the open endpoints.
      const inverseE = 1 / e
      const limit = Math.acosh(HYPERBOLA_EXTENT_SCALE * Math.max(inverseE, 1 - inverseE) + inverseE)
      for (let i = 0; i <= segments; i++) {
        const h = (2 * i / segments - 1) * limit
        // cosh(H)-1 = 2*sinh(H/2)^2 avoids cancellation near a parabola.
        points.push(new Vector3(
          periapsis - 2 * a * Math.sinh(h / 2) ** 2,
          minorAxis * Math.sinh(h),
          0
        ).applyQuaternion(frame))
      }
      return points
    }

    for (let i: number = 0; i <= segments; i++) {
      const trueAnomaly: number = (i / segments) * Math.PI * 2
      const localPos: Vector3 = keplerianModel.getOwnCoordsByTrueAnomaly(trueAnomaly)
      const worldPos: Vector3 = localPos.applyQuaternion(frame)

      points.push(worldPos)
    }

    return points
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitRootNode(this)
  }
}

export { OrbitLine }
