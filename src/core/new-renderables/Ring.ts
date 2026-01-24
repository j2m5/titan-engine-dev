import { BufferGeometry, Mesh, RingGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { RingMaterial } from '@/core/materials/RingMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class Ring extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  public constructor(model: Actor) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    const innerRadius: number = toThreeJSUnits(this.model.renderingObject!.getAttribute('data').innerRadius)
    const outerRadius: number = toThreeJSUnits(this.model.renderingObject!.getAttribute('data').outerRadius)

    this.geometry = new RingGeometry(innerRadius, outerRadius, 256)
    this.material = new RingMaterial(this.model)

    this.name = this.model.getAttribute('name') + 'Ring'
    this.rotateX(degToRad(-this.model.parent!.physicalObject!.getAttribute('axialTilt', 0)))
  }
}

export { Ring }
