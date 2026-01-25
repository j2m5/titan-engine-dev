import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { AtmosphereMaterial } from '@/core/materials/AtmosphereMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class Atmosphere extends Mesh implements Acceptable<IObject3DVisitor> {
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
    this.material = new AtmosphereMaterial(this.model)

    this.name = this.model.getAttribute('name') + 'Atmosphere'
    this.rotateX(degToRad(-90))
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitComponent(this)
  }
}

export { Atmosphere }
