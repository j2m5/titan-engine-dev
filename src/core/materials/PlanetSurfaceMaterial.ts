import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import type { PlanetSurfaceShader } from '@/core/materials/shaders/PlanetSurfaceShader'
import { Color, Texture, Uniform, Vector3 } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { terrainDataOf } from '@/core/terrain/terrainClassPresets'
import { IPlanetRenderingObject } from '@/core/models/types'
import { readRenderingData } from '@/core/helpers/renderingData'
import { proceduralDiffuseKey } from '@/core/services/ProceduralSurfaceGenerator'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { SunTintBinding } from '@/core/materials/SunTintBinding'
import { ATMOSPHERE_CATEGORY_ID } from '@/core/constants'
import { resolveLightTint } from '@/core/helpers/lightSource'

/**
 * Opacity облачного слоя от высоты камеры над поверхностью: 1.0 из космоса
 * (alt ≥ H, вся толщина атмосферы над камерой), линейно к 0 на середине
 * толщины (alt = 0.5·H), 0 ниже. Чистая функция от alt/H — юнит-независима
 * (числитель и знаменатель в одних юнитах), считается на CPU и уходит в
 * юниформ готовым числом.
 */
export function cloudOpacityForAltitude(altitudeUnits: number, atmosphereThicknessUnits: number): number {
  const half = 0.5 * Math.max(atmosphereThicknessUnits, 1e-6) // гард от деления на 0/отрицательной толщины (битые данные)

  return Math.max(0, Math.min(1, (altitudeUnits - half) / half))
}

/** Карты и данные тела, общие для обоих путей, — вход пути в updateMaterial. */
export interface SurfaceMaps {
  planetData: IPlanetRenderingObject
  cloudMap: Texture | undefined
  specularMap: Texture | undefined
}

/**
 * Общая база материалов поверхности планеты (сфера и патчи рельефа):
 * атмосфера-ребёнок, радиус, закатный тинт, цвет света звезды, высотный fade
 * облаков, общие карты и дефайны. Свои карты, юниформы и дефайны путь ставит
 * в updatePath / resetPath.
 */
abstract class PlanetSurfaceMaterial extends AbstractShaderMaterial {
  public model: Actor

  /**
   * Снимок дефайнов, поставленных шейдером при конструировании (тень колец,
   * реголит, цвет света).
   *
   * `updateMaterial` пересобирает набор дефайнов от этого снимка, а не поверх
   * прошлого состояния: накопление (`{ ...this.defines, ... }`) не умеет
   * СНИМАТЬ дефайн — карта, вытесненная стримером, оставляла бы свой `#define`
   * включённым, и шейдер сэмплил бы пустую чёрную текстуру three.
   */
  private readonly baseDefines: Record<string, unknown>

  /** Дочерний актор-атмосфера (резолвится один раз); undefined — атмосферы нет. */
  protected readonly atmosphereActor: Actor | undefined

  /**
   * Толщина атмосферы тела (top−bottom radius, юниты сцены) — резолвится один
   * раз по дочернему актору-атмосфере. `undefined` — атмосферы нет (или у неё
   * нет renderingObject.data): opacity облаков держится константой 1.
   */
  private readonly cloudAtmosphereThicknessUnits: number | undefined

  /** Радиус тела (юниты сцены); 0 у стаб-акторов тестов без physicalObject. */
  private readonly bodyRadiusUnits: number

  /** Проводка закатного тинта из реестра атмосфер — общая с водной оболочкой (см. SunTintBinding). */
  private readonly sunTint: SunTintBinding

  /** Подписка светила на цвет света (lightTint) — резолвится один раз, тело не меняет родителя в рантайме. */
  private readonly lightTint: { active: boolean; color: Color }

  protected constructor(model: Actor, atmosphereRegistry: AtmosphereRegistry | undefined, shader: PlanetSurfaceShader<string>) {
    super()
    this.model = model
    // Дочерняя атмосфера резолвится один раз — толщина и actorId читаются из одного актора
    this.atmosphereActor = model.children.where('categoryId', ATMOSPHERE_CATEGORY_ID).first()
    const radiusKm: number = this.model.physicalObject?.getAttribute('radius') ?? 0
    this.cloudAtmosphereThicknessUnits = PlanetSurfaceMaterial.resolveCloudAtmosphereThicknessUnits(this.atmosphereActor)
    this.bodyRadiusUnits = toThreeJSUnits(radiusKm)
    this.sunTint = new SunTintBinding(
      this,
      atmosphereRegistry,
      this.atmosphereActor?.getAttribute('id') as number | undefined,
      radiusKm
    )
    this.lightTint = resolveLightTint(model)

    const { uniforms, defines, vertexShader, fragmentShader } = shader

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    // lightTint статичен — живёт в снимке, как USE_WATER_REFLECTION у воды:
    // переживает и updateMaterial(), и resetMaterial() без досборки
    this.baseDefines = {
      ...defines,
      ...(this.lightTint.active && { USE_LIGHT_TINT: '1' })
    }
    this.defines = { ...this.baseDefines }

    // Цвет света звезды — юниформ материала, не шейдера: дефолт белый, значение копируется один раз
    this.uniforms.uLightColor = new Uniform(new Color(1, 1, 1))
    ;(this.uniforms.uLightColor.value as Color).copy(this.lightTint.color)
  }

  private static resolveCloudAtmosphereThicknessUnits(atmosphereActor: Actor | undefined): number | undefined {
    if (!atmosphereActor) return undefined

    const config = readRenderingData<AtmosphereConfig>(atmosphereActor)

    if (!config) return undefined

    return toThreeJSUnits(config.topRadius - config.bottomRadius)
  }

  /**
   * Высотный fade облаков — каждый активный кадр (дистанция камера-тело
   * меняется каждый кадр). Мировые позиции — на вызывающей стороне, здесь
   * только вычитание и формула. Без атмосферы opacity держится константой 1.
   */
  public updateCloudOpacity(cameraWorldPosition: Vector3, modelWorldPosition: Vector3): void {
    if (this.cloudAtmosphereThicknessUnits === undefined) {
      this.uniforms.uCloudOpacity.value = 1

      return
    }

    const altitudeUnits = cameraWorldPosition.distanceTo(modelWorldPosition) - this.bodyRadiusUnits

    this.uniforms.uCloudOpacity.value = cloudOpacityForAltitude(altitudeUnits, this.cloudAtmosphereThicknessUnits)
  }

  /**
   * Тинт солнца у терминатора — каждый видимый кадр (Planet.updateObject,
   * TerrainSphere.onVisibleUpdate); механика в SunTintBinding (общей с водной
   * оболочкой), здесь только точка входа материала.
   */
  public syncSunTint(): void {
    this.sunTint.sync()
  }

  /**
   * Ключ диффуза тела: у процедурного (`data.proceduralSurface`) — синтетический
   * ключ рантайм-генератора (текстуру под ним регистрирует
   * `ProceduralSurfaceGenerator.ensureDiffuse` до постройки материала), у
   * обычного — путь ресурса из БД. Нет ресурса — пустая строка:
   * getTextureOrMake отдаёт по ней плейсхолдер.
   */
  protected diffuseKey(): string {
    const proceduralSurface = readRenderingData<IPlanetRenderingObject>(this.model)?.proceduralSurface

    if (proceduralSurface) return proceduralDiffuseKey(this.model.getAttribute('id', -1))

    return this.model.resources.where('resourceType', 'diffuse').first()?.getAttribute('path') ?? ''
  }

  /** Карты, юниформы и дефайны пути; возвращает дефайны пути поверх общих. */
  protected abstract updatePath(maps: SurfaceMaps): Record<string, string>

  /** Сброс юниформов пути к состоянию «карт нет». */
  protected abstract resetPath(): void

  public updateMaterial(): void {
    const diffuseMap: Texture = resourceStorage.getTextureOrMake(this.diffuseKey())
    const nightMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'night').first()?.getAttribute('path') ?? ''
    )
    const cloudMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'cloud').first()?.getAttribute('path') ?? ''
    )
    const specularMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'specular').first()?.getAttribute('path') ?? ''
    )

    // Данные облика: пресет класса под данными тела (terrainClassPresets.ts).
    const planetData: IPlanetRenderingObject = terrainDataOf(this.model)

    this.uniforms.diffuseMap.value = diffuseMap
    this.uniforms.nightMap.value = nightMap
    this.uniforms.cloudMap.value = cloudMap

    const pathDefines = this.updatePath({ planetData, cloudMap, specularMap })

    // Набор собирается от снимка конструирования, а не поверх прошлого: только
    // так дефайн ушедшей карты исчезает вместе с ней (см. baseDefines).
    this.defines = {
      ...this.baseDefines,
      ...pathDefines,
      ...(nightMap && { USE_NIGHT: '1' }),
      // Облачный слой — при наличии cloudMap; у поверхности его гасит высотный
      // fade (uCloudOpacity → 0 к середине толщины атмосферы)
      ...(cloudMap && { USE_CLOUD: '1' }),
      // Пересборка от снимка стирает и дефайны атмосферных LUT — они не про
      // карты и живут своей синхронизацией, поэтому восстанавливаются здесь же
      // по текущей записи реестра (иначе стриминг карт гасил бы тинт до
      // следующей смены записи). Пара USE_SUN_TINT / USE_SKY_AMBIENT
      // неразрывна: обе таблицы приходят одной записью реестра.
      // USE_LIGHT_TINT статичен и уже в baseDefines.
      ...(this.sunTint.active && { USE_SUN_TINT: '1', USE_SKY_AMBIENT: '1' })
    }

    this.needsUpdate = true
  }

  public resetMaterial(): void {
    this.uniforms.diffuseMap.value = resourceStorage.getTextureOrMake('default.png')
    this.uniforms.nightMap.value = resourceStorage.getTextureOrMake('night.jpg')
    this.uniforms.cloudMap.value = null

    this.resetPath()

    // Возврат к состоянию «карт нет» — это и есть снимок конструирования:
    // поимённый список дефайнов пришлось бы держать в синхроне вручную
    this.defines = { ...this.baseDefines }
    // Снимок конструирования тинта не знает — проводка забывает запись, чтобы
    // ближайший syncSunTint увидел смену и вернул дефайн одним рекомпилом.
    this.sunTint.reset()

    this.needsUpdate = true
  }
}

export { PlanetSurfaceMaterial }
