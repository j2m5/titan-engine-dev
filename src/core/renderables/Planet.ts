import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'

/** Легаси-сфера тел без карты высот; рельефные тела строит TerrainSphere. */
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
    const radiusKm: number = this.model.physicalObject!.getAttribute('radius')!
    const radius: number = toThreeJSUnits(radiusKm)
    const circumscribe: number = 1 / (Math.cos(Math.PI / 256) * Math.cos(Math.PI / 512))

    this.geometry = new SphereGeometry(radius * circumscribe, 256, 256)
    this.material = new PlanetMaterial(this.model)
    this.name = this.model.getAttribute('name', '') + 'Planet'
    this.userData.type = 'planet'
    this.userData.clickable = true
  }
}

export { Planet }
