import { type WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'

export { PATCH_BUILDS_PER_FRAME } from '@/core/terrain/TerrainPatchGroup'

/**
 * Рельеф тела кубосферой из патчей ПЕРЕМЕННОЙ глубины — квадродерево/пул/юбки
 * общие с WaterSphere, вынесены в TerrainPatchGroup (см. её докблок); эта
 * специализация добавляет то, что относится к рельефу конкретно: PlanetMaterial
 * из Actor и контракт снапшота/ResourceObserver (model/type/clickable на
 * группе, .material — PlanetMaterial, единственный на все патчи).
 */
class TerrainSphere extends TerrainPatchGroup {
  public model: Actor
  private readonly sharedMaterial: PlanetMaterial

  public constructor(model: Actor, field: TerrainHeightField, renderer: WebGLRenderer) {
    const sharedMaterial = new PlanetMaterial(model)
    super(field, sharedMaterial, renderer)
    this.model = model
    this.sharedMaterial = sharedMaterial

    this.name = this.model.getAttribute('name', '') + 'Planet'
    this.userData.type = 'planet'
    this.userData.clickable = true
  }

  /** Контракт ResourceObserver: у renderable один материал на все патчи. */
  public get material(): PlanetMaterial {
    return this.sharedMaterial
  }
}

export { TerrainSphere }
