import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { HaloMaterial } from '@/core/materials/HaloMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class Halo extends Mesh implements Acceptable<IObject3DVisitor> {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  public constructor(model: Actor) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    const radius: number = toThreeJSUnits(this.model.renderingObject!.getAttribute('data').radius)

    this.geometry = new SphereGeometry(radius, 128, 128)
    this.material = new HaloMaterial(this.model)

    this.name = this.model.getAttribute('name') + 'Halo'
    this.rotateX(degToRad(this.model.parent!.physicalObject!.getAttribute('axialTilt', 0)))
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitComponent(this)
  }
}

export { Halo }
