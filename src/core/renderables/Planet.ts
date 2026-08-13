import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { buildDisplacedSphere, TERRAIN_SPHERE_SEGMENTS } from '@/core/terrain/heightSampling'

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
    const radius: number = toThreeJSUnits(this.model.physicalObject!.getAttribute('radius')!)
    const heightPath = this.model.resources.where('resourceType', 'height').first()?.getAttribute('path')
    const heightMap = typeof heightPath === 'string' ? heightFieldStorage.get(heightPath) : undefined

    if (heightMap) {
      // Честный рельеф: смещение вершин по карте, нормали из её градиента.
      // circumscribe не нужен — поправка на фасетку тонет в амплитуде рельефа.
      this.geometry = buildDisplacedSphere(radius, heightMap, TERRAIN_SPHERE_SEGMENTS)
    } else {
      const circumscribe: number = 1 / (Math.cos(Math.PI / 256) * Math.cos(Math.PI / 512))
      this.geometry = new SphereGeometry(radius * circumscribe, 256, 256)
    }

    this.material = new PlanetMaterial(this.model)
    this.name = this.model.getAttribute('name', '') + 'Planet'
    this.userData.type = 'planet'
    this.userData.clickable = true
  }
}

export { Planet }
