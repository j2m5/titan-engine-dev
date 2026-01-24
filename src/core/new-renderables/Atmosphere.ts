import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { AtmosphereMaterial } from '@/core/materials/AtmosphereMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class Atmosphere extends Mesh {
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
}

export { Atmosphere }
