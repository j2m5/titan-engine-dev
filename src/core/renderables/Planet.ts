import { BufferGeometry, Mesh, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { SphereDetail } from '@/core/renderables/utils/SphereDetail'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import type { UpdateContext } from '@/core/UpdateContext'

/** Легаси-сфера тел без карты высот; рельефные тела строит TerrainSphere. */
class Planet extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  /** Тот же материал, что this.material — типизированная ссылка для пер-кадрового хука. */
  private planetMaterial!: PlanetMaterial

  /** Грубая сфера вдали, плотная 256 — пока тело крупно в кадре. */
  private sphereDetail!: SphereDetail

  private readonly worldScratch = new Vector3()

  public constructor(model: Actor, atmosphereRegistry?: AtmosphereRegistry) {
    super()
    this.model = model

    this.__setup(atmosphereRegistry)
  }

  __setup(atmosphereRegistry?: AtmosphereRegistry): void {
    const radiusKm: number = this.model.physicalObject!.getAttribute('radius')!
    const radius: number = toThreeJSUnits(radiusKm)

    // Многогранник описан вокруг истинной сферы под сегментацию каждого уровня:
    // силуэт не проваливается внутрь неё
    this.sphereDetail = new SphereDetail(this, radius, { denseSegments: 256, circumscribe: true })
    this.planetMaterial = new PlanetMaterial(this.model, atmosphereRegistry)
    this.material = this.planetMaterial
    this.name = this.model.getAttribute('name', '') + 'Planet'
    this.userData.type = 'planet'
    this.userData.clickable = true
  }

  /**
   * Детализация сферы, тинт солнца и полутень тени колец. Детализация — первой:
   * свап геометрии допустим только здесь, до рендера (см. SphereDetail).
   * Запись реестра резолвится каждый кадр (порядок создания узлов не важен,
   * снятие атмосферы гасит эффект). Вызов пустой, пока запись та же — тот же
   * хук, что TerrainSphere.onVisibleUpdate у рельефных тел.
   */
  public updateObject(ctx: UpdateContext): void {
    this.sphereDetail.update(ctx.camera)
    this.planetMaterial.syncSunTint()
    this.planetMaterial.syncTerrainShadow(this.getWorldPosition(this.worldScratch))
  }
}

export { Planet }
