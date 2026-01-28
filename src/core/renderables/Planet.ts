import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class Planet extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  public constructor(model: Actor) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    const radius: number = toThreeJSUnits(this.model.physicalObject!.getAttribute('radius'))

    this.geometry = new SphereGeometry(radius, 256, 256)
    this.material = new PlanetMaterial(this.model)

    this.name = this.model.getAttribute('name') + 'Planet'
    this.userData.type = 'planet'
    this.userData.clickable = true
    this.rotateX(degToRad(-90))
    this.rotateX(degToRad(-this.model.physicalObject!.getAttribute('axialTilt', 0)))
  }
}

export { Planet }
