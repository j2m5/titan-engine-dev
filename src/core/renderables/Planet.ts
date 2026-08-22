import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import type { UpdateContext } from '@/core/UpdateContext'

/** Легаси-сфера тел без карты высот; рельефные тела строит TerrainSphere. */
class Planet extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  /** Тот же материал, что this.material — типизированная ссылка для пер-кадрового хука. */
  private planetMaterial!: PlanetMaterial

  public constructor(model: Actor, atmosphereRegistry?: AtmosphereRegistry) {
    super()
    this.model = model

    this.__setup(atmosphereRegistry)
  }

  __setup(atmosphereRegistry?: AtmosphereRegistry): void {
    const radiusKm: number = this.model.physicalObject!.getAttribute('radius')!
    const radius: number = toThreeJSUnits(radiusKm)
    const circumscribe: number = 1 / (Math.cos(Math.PI / 256) * Math.cos(Math.PI / 512))

    this.geometry = new SphereGeometry(radius * circumscribe, 256, 256)
    this.planetMaterial = new PlanetMaterial(this.model, atmosphereRegistry)
    this.material = this.planetMaterial
    this.name = this.model.getAttribute('name', '') + 'Planet'
    this.userData.type = 'planet'
    this.userData.clickable = true
  }

  /**
   * Тинт солнца: запись реестра резолвится каждый кадр (порядок создания узлов
   * не важен, снятие атмосферы гасит эффект). Вызов пустой, пока запись та же —
   * тот же хук, что TerrainSphere.onVisibleUpdate у рельефных тел.
   */
  public updateObject(_ctx: UpdateContext): void {
    this.planetMaterial.syncSunTint()
  }
}

export { Planet }
