import { type WebGLRenderer, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'
import { readWaterLevelMeters } from '@/core/terrain/waterLevel'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import type { ProceduralSurfaceGenerator } from '@/core/services/ProceduralSurfaceGenerator'
import type { IPlanetRenderingObject } from '@/core/models/types'
import type { UpdateContext } from '@/core/UpdateContext'

export { PATCH_BUILDS_PER_FRAME } from '@/core/terrain/TerrainPatchGroup'

/**
 * Рельеф тела кубосферой из патчей ПЕРЕМЕННОЙ глубины — квадродерево/пул/юбки
 * общие с WaterSphere, вынесены в TerrainPatchGroup (см. её докблок); эта
 * специализация добавляет то, что относится к рельефу конкретно: PlanetMaterial
 * из Actor и контракт снапшота/ResourceObserver (model/type/clickable на
 * группе, .material — PlanetMaterial, единственный на все патчи).
 *
 * Уровень воды (Task 5, water-foundation) читается здесь же и передаётся
 * TerrainPatchGroup только как гейт SSE-потолка подводных патчей —
 * WaterSphere сама висит отдельной оболочкой (RenderableFactory), эта ручка
 * её не строит, только ограничивает глубину дерева РЕЛЬЕФА под водой.
 */
class TerrainSphere extends TerrainPatchGroup {
  public model: Actor
  private readonly sharedMaterial: PlanetMaterial

  // Скретчи кадра (см. TerrainPatchGroup.cameraWorldScratch — тот же приём,
  // приватный там, недоступен подклассу): облачный высотный fade нужен
  // РОВНО в момент onVisibleUpdate, а не после (TerrainPatchGroup.
  // updateObject считает свой cameraWorldScratch ПОСЛЕ onVisibleUpdate —
  // повторное использование читало бы позицию камеры прошлого кадра).
  private readonly cloudCameraWorldScratch = new Vector3()
  private readonly cloudSelfWorldScratch = new Vector3()

  public constructor(
    model: Actor,
    field: TerrainHeightField,
    renderer: WebGLRenderer,
    atmosphereRegistry?: AtmosphereRegistry,
    proceduralSurfaceGenerator?: ProceduralSurfaceGenerator
  ) {
    // Диффуз процедурного тела обязан лежать в resourceStorage ДО постройки
    // PlanetMaterial: конструктор материала сажает диффуз в юниформ уже в
    // updateMaterial/резолве PlanetShader (см. PlanetMaterial.diffuseKey) —
    // без этого шага тело схлопывается на плейсхолдер. Тела без ручки — no-op
    // здесь и в самом ensureDiffuse (гейт по data.proceduralSurface совпадает).
    if (proceduralSurfaceGenerator && readRenderingData<IPlanetRenderingObject>(model)?.proceduralSurface) {
      proceduralSurfaceGenerator.ensureDiffuse(model)
    }

    const sharedMaterial = new PlanetMaterial(model, atmosphereRegistry)
    const waterLevelMeters = readWaterLevelMeters(model)
    const detailWrap = detailWrapFor(readRenderingData<IPlanetRenderingObject>(model))
    super(field, sharedMaterial, renderer, undefined, waterLevelMeters, detailWrap)
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

  /**
   * Высотный fade облаков (приёмочная волна 4, №3) — каждый активный кадр
   * (тот же паттерн, что WaterSphere.onVisibleUpdate/uTime): дистанция
   * камера-тело меняется с каждым кадром, а формула/резолв толщины
   * атмосферы живут в PlanetMaterial (см. её докблок) — здесь только мировые
   * позиции, дешёвые и без аллокаций (скретчи выше).
   *
   * Тинт солнца синхронизируется здесь же: узел атмосферы мог появиться или
   * уйти после конструирования материала, а сам вызов на кадрах без смены
   * записи пустой (сравнение по ссылке внутри).
   */
  protected onVisibleUpdate(ctx: UpdateContext): void {
    ctx.camera.getWorldPosition(this.cloudCameraWorldScratch)
    this.getWorldPosition(this.cloudSelfWorldScratch)
    this.sharedMaterial.updateCloudOpacity(this.cloudCameraWorldScratch, this.cloudSelfWorldScratch)
    this.sharedMaterial.syncSunTint()
  }
}

export { TerrainSphere }
