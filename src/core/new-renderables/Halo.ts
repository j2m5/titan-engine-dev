import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { HaloMaterial } from '@/core/materials/HaloMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class Halo extends Mesh {
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
    this.rotateX(degToRad(-90))
  }
}

export { Halo }
