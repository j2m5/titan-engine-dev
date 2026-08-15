import { Group, Mesh } from 'three'
import { Actor } from '@/core/models/Actor'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { CUBE_FACES, TERRAIN_PATCH_DEPTH, TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'

/**
 * Рельеф тела кубосферой из патчей фиксированной глубины (этап 3а; квадродерево
 * 3б сделает глубину переменной). Патчи делят один PlanetMaterial — стриминг
 * дёргает updateMaterial один раз через геттер .material (контракт
 * ResourceObserver). RTC: вершины патча относительны его центру, центр — в
 * position меша; штатный frustumCulled патчей остаётся включён — у горизонта
 * рисуется лишь часть кубосферы. model/type — на группе: SceneObserver и
 * коллизия видят её как прежний меш планеты (тот же matrixWorld).
 *
 * Собственный dispose не нужен: disposeSceneTree обходит детей и освобождает
 * геометрию/материал каждого меша (материал общий — dispose идемпотентен;
 * общий индекс освобождается с первой геометрией, teardown однократный).
 */
class TerrainSphere extends Group {
  public model: Actor
  private readonly sharedMaterial: PlanetMaterial

  public constructor(model: Actor, field: TerrainHeightField) {
    super()
    this.model = model
    this.sharedMaterial = new PlanetMaterial(model)

    const index = buildPatchIndex(TERRAIN_PATCH_SEGMENTS)
    const patches = 1 << TERRAIN_PATCH_DEPTH

    for (let face = 0; face < CUBE_FACES; face++) {
      for (let j = 0; j < patches; j++) {
        for (let i = 0; i < patches; i++) {
          const { geometry, center } = buildTerrainPatchGeometry(
            field,
            face,
            i,
            j,
            TERRAIN_PATCH_DEPTH,
            TERRAIN_PATCH_SEGMENTS,
            index
          )

          const patch = new Mesh(geometry, this.sharedMaterial)
          patch.position.copy(center)
          // клик-фильтр Engine.onClick смотрит на пересечённый объект — сам патч
          patch.userData.clickable = true
          this.add(patch)
        }
      }
    }

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
