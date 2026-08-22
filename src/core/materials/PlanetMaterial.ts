import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Texture, Vector3 } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { readWaterLevelMeters } from '@/core/terrain/waterLevel'
import { IPlanetRenderingObject } from '@/core/models/types'
import { readRenderingData } from '@/core/helpers/renderingData'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { SunTintBinding } from '@/core/materials/sunTintBinding'
import { ATMOSPHERE_CATEGORY_ID } from '@/core/constants'

/**
 * Opacity облачного слоя от высоты камеры над поверхностью (приёмочная волна
 * 4, №3 — идея владельца): 1.0 из космоса (alt ≥ H, вся толщина атмосферы над
 * камерой), линейно к 0 на середине толщины (alt = 0.5·H), 0 ниже. Чистая
 * функция от alt/H — юнит-независима (числитель и знаменатель в ОДНИХ и тех
 * же юнитах сокращаются), тестируется напрямую без CPU-зеркала шейдера (сама
 * формула считается в TS/JS, не в GLSL — уходит в юниформ уже готовым числом,
 * как uWaterNightFloor и прочие ручки).
 */
export function cloudOpacityForAltitude(altitudeUnits: number, atmosphereThicknessUnits: number): number {
  const half = 0.5 * Math.max(atmosphereThicknessUnits, 1e-6) // гард от деления на 0/отрицательной толщины (битые данные)

  return Math.max(0, Math.min(1, (altitudeUnits - half) / half))
}

class PlanetMaterial extends AbstractShaderMaterial {
  public model: Actor

  /**
   * Снимок дефайнов, поставленных шейдером при конструировании (тень колец).
   *
   * `updateMaterial` пересобирает набор дефайнов от этого снимка, а не поверх
   * прошлого состояния. Накопление (`{ ...this.defines, ... }`) не умело
   * СНИМАТЬ дефайн: ложный spread — это no-op, поэтому карта, вытесненная
   * стримером, оставляла свой `#define` включённым навсегда. Шейдер продолжал
   * сэмплить сэмплер, в который three подставляет пустую чёрную текстуру, и
   * декод читал из неё мусор вместо признания «карты нет».
   */
  private readonly baseDefines: Record<string, unknown>

  /**
   * Толщина атмосферы тела (top−bottom radius, юниты сцены) — резолвится ОДИН
   * раз в конструкторе по дочернему актору-атмосфере (тот же паттерн, что
   * ringData/USE_RING в PlanetShader: `model.children.where('categoryId', N)`,
   * разовый резолв, не на каждый кадр). `undefined` — у тела нет атмосферы
   * (нет актора categoryId=5 ИЛИ у него нет renderingObject.data) — облачный
   * слой такому телу без атмосферы не положен по смыслу фичи, но если данные
   * когда-нибудь дадут cloudMap без атмосферы, opacity держится константой 1
   * (см. updateCloudOpacity) — не гасить то, что нечем гасить.
   */
  private readonly cloudAtmosphereThicknessUnits: number | undefined

  /** Радиус тела (юниты сцены) — та же экономия ORM/аллокаций, что и толщина атмосферы выше; 0 у стаб-акторов тестов без physicalObject. */
  private readonly bodyRadiusUnits: number

  /** Проводка закатного тинта из реестра атмосфер — общая с водной оболочкой (см. SunTintBinding). */
  private readonly sunTint: SunTintBinding

  public constructor(model: Actor, atmosphereRegistry?: AtmosphereRegistry, parameters?: ShaderMaterialParameters) {
    super(parameters)
    this.model = model
    // Дочерняя атмосфера резолвится ОДИН раз — толщина и actorId читаются из
    // одного и того же актора, а не двух отдельных обходов ORM.
    const atmosphereActor = model.children.where('categoryId', ATMOSPHERE_CATEGORY_ID).first()
    const radiusKm: number = this.model.physicalObject?.getAttribute('radius') ?? 0
    this.cloudAtmosphereThicknessUnits = PlanetMaterial.resolveCloudAtmosphereThicknessUnits(atmosphereActor)
    this.bodyRadiusUnits = toThreeJSUnits(radiusKm)
    this.sunTint = new SunTintBinding(
      this,
      atmosphereRegistry,
      atmosphereActor?.getAttribute('id') as number | undefined,
      radiusKm
    )

    const { uniforms, defines, vertexShader, fragmentShader } = new PlanetShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines
    this.baseDefines = { ...defines }
  }

  private static resolveCloudAtmosphereThicknessUnits(atmosphereActor: Actor | undefined): number | undefined {
    if (!atmosphereActor) return undefined

    const config = readRenderingData<AtmosphereConfig>(atmosphereActor)

    if (!config) return undefined

    return toThreeJSUnits(config.topRadius - config.bottomRadius)
  }

  /**
   * Высотный fade облаков (приёмочная волна 4, №3) — вызывается КАЖДЫЙ
   * активный кадр (см. TerrainSphere.onVisibleUpdate, тот же паттерн, что
   * WaterMaterial.updateMaterial(elapsed)): дистанция камера-тело меняется
   * каждый кадр, юниформ обязан догонять. Мировые позиции — на вызывающей
   * стороне (TerrainSphere владеет своей мировой позицией и позицией камеры
   * из UpdateContext, см. AsteroidRingSystem/NebulaVolume — тот же приём
   * скретч-векторов кадра без аллокаций); здесь только вычитание и формула.
   * Без атмосферы (cloudAtmosphereThicknessUnits === undefined) opacity
   * держится константой 1 — тело без атмосферы не в скоупе этой фичи.
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
   * Тинт солнца у терминатора — вызывается КАЖДЫЙ видимый кадр (Planet.
   * updateObject, TerrainSphere.onVisibleUpdate); вся механика в SunTintBinding
   * (общей с водной оболочкой), здесь только точка входа материала.
   */
  public syncSunTint(): void {
    this.sunTint.sync()
  }

  public updateMaterial(): void {
    const diffuseMap: Texture = resourceStorage.getTextureOrMake(
      this.model.resources.where('resourceType', 'diffuse').first()?.getAttribute('path') ?? ''
    )
    const nightMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'night').first()?.getAttribute('path') ?? ''
    )
    const cloudMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'cloud').first()?.getAttribute('path') ?? ''
    )
    const specularMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'specular').first()?.getAttribute('path') ?? ''
    )
    // Рельефный шейдинг сверяется с фактически загруженной картой высот — тем
    // же реестром, по которому Planet строил геометрию. Строка БД тут не
    // авторитет: если карта не доехала (HeightFieldStorage предупредил и
    // пропустил), сфера гладкая, и кратерный slope-шейдинг на ней был бы
    // враньём — тогда рельефные дефайны молчат целиком.
    const heightPath: string | undefined = heightPathOf(this.model)
    const hasHeightField = heightPath !== undefined && Boolean(heightFieldStorage.get(heightPath))
    const hasWaterShell = readWaterLevelMeters(this.model) !== undefined

    // slope-карта — уклоны из той же карты высот (см. slopeMapFormat): шейдит
    // попиксельно то, что не влезло в вершинную сетку, мипы фильтруют издалека.
    // Классический bump живёт только у тел без честного рельефа.
    //
    // Отсутствие строки ресурса — undefined, а не запрос по '': в хранилище
    // живёт плейсхолдер с пустым именем (getTextureOrMake('') у колец), и
    // фолбэк на '' находил бы его как фантомную карту рельефа.
    const textureOf = (
      type: 'slope' | 'bump' | 'detailDiffuse' | 'detailNormal' | 'detailArm' | 'detailNormal2'
    ): Texture | undefined => {
      const path = this.model.resources.where('resourceType', type).first()?.getAttribute('path')

      return typeof path === 'string' ? resourceStorage.getTexture(path) : undefined
    }
    const slopeMap = textureOf('slope')
    const legacyBumpMap = textureOf('bump')
    const bumpMap: Texture | undefined = hasHeightField ? slopeMap : legacyBumpMap
    const useSlope = hasHeightField && Boolean(slopeMap)

    // Cavity-затемнение альбедо (арка slope-cavity, канал B slope-карты) —
    // ручка пер-тела, отсутствие поля = 0 (Task 3 её пока не расставляет).
    // Юниформ форвардится из data независимо от гейта ниже: значение само по
    // себе безвредно, шейдер читает его только под USE_CAVITY.
    const planetData: IPlanetRenderingObject = (this.model.renderingObject?.getAttribute('data') as
      | IPlanetRenderingObject
      | undefined) ?? {
      bumpScale: 0,
      emission: 1
    }
    const cavityStrength = planetData.cavityStrength ?? 0

    // Терраформный детальный слой (задача 4, чанк TerrainDetail): крупная
    // нормаль — база слоя, её наличие и есть условие USE_TERRAIN_DETAIL.
    // AO/diffuse/мелкая нормаль опциональны — гейтятся рантайм-юниформом
    // uDetailLayerGates, а не #ifdef, чтобы не требовать перекомпиляции
    // программы при догрузке отдельной карты.
    const detailNorMap = textureOf('detailNormal')
    const detailDiffMap = textureOf('detailDiffuse')
    const detailArmMap = textureOf('detailArm')
    const detailNor2Map = textureOf('detailNormal2')
    const USE_TERRAIN_DETAIL = hasHeightField && Boolean(detailNorMap)

    this.uniforms.diffuseMap.value = diffuseMap
    this.uniforms.nightMap.value = nightMap
    this.uniforms.cloudMap.value = cloudMap
    this.uniforms.specularMap.value = specularMap
    this.uniforms.bumpMap.value = bumpMap
    this.uniforms.uCavityStrength.value = cavityStrength

    this.uniforms.uDetailNorMap.value = detailNorMap ?? null
    this.uniforms.uDetailDiffMap.value = detailDiffMap ?? null
    this.uniforms.uDetailArmMap.value = detailArmMap ?? null
    this.uniforms.uDetailNor2Map.value = detailNor2Map ?? null
    this.uniforms.uDetailLayerGates.value.set(detailArmMap ? 1 : 0, detailDiffMap ? 1 : 0, detailNor2Map ? 1 : 0)

    // Шаг выборки соседних текселей для аналитического градиента нормали —
    // атрибут четырёхвыборочного bump-пути; slope-путь читает одну выборку.
    // Нули = рельеф выключен: все четыре выборки совпадают, градиент нулевой —
    // безопасное поведение, пока карта не загружена.
    const bumpImage = bumpMap?.image as { width?: number; height?: number } | undefined
    const useClassicBump = !hasHeightField && Boolean(legacyBumpMap)
    this.uniforms.uBumpTexelSize.value.set(
      useClassicBump && bumpImage?.width ? 1 / bumpImage.width : 0,
      useClassicBump && bumpImage?.height ? 1 / bumpImage.height : 0
    )

    // Набор собирается от снимка конструирования, а не поверх прошлого: только
    // так дефайн ушедшей карты исчезает вместе с ней (см. baseDefines).
    this.defines = {
      ...this.baseDefines,
      ...(useClassicBump && { USE_BUMP: '1' }),
      ...(useSlope && { USE_SLOPE: '1' }),
      // Попиксельный UV из направления вместо вершинного vUv — вершинная
      // развёртка кубосферы вырождается у полюсов (см. PlanetShaderTemplate).
      // Тот же реестр карт высот, что решает геометрию TerrainSphere.
      ...(hasHeightField && { USE_TERRAIN_UV: '1' }),
      ...(USE_TERRAIN_DETAIL && { USE_TERRAIN_DETAIL: '1' }),
      // Гейт: тот же slope, что USE_SLOPE (без него канал B недоступен), И
      // ненулевая ручка — при cavityStrength 0 путь бит-в-бит прежним.
      ...(useSlope && cavityStrength > 0 && { USE_CAVITY: '1' }),
      // Specular-карта — маска «океан/суша» легаси-вида. У тела с водной
      // оболочкой (WaterSphere) блик солнца принадлежит воде: HDR-блик суши
      // под полупрозрачной водой просачивался вторым, белым бликом поверх
      // голубого водного.
      ...(specularMap && !hasWaterShell && { USE_SPECULAR: '1' }),
      ...(nightMap && { USE_NIGHT: '1' }),
      // Облачный слой ВЕРНУЛСЯ решением владельца (2026-08-19, приёмочная
      // волна 4, №3: идея владельца — высотный fade). Прежний рулинг
      // (приёмочная волна 2, №2 — полосы на полюсах от терраформной
      // равнопрямоугольной UV-развёртки) снят: облака теперь гаснут ДО того,
      // как камера подлетает достаточно близко, чтобы полосы стали заметны
      // (uCloudOpacity → 0 к середине толщины атмосферы, см. её докблок в
      // PlanetShaderTemplate) — полюсный артефакт больше не в кадре у тел
      // с атмосферой. Гейт снова
      // ставится ПРИ НАЛИЧИИ cloudMap, как до волны 2.
      ...(cloudMap && { USE_CLOUD: '1' }),
      // Пересборка от снимка стирает и дефайн тинта — он не про карты и живёт
      // своей синхронизацией, поэтому восстанавливается здесь же по текущей
      // записи реестра (иначе стриминг карт гасил бы тинт до следующей смены
      // записи, которой может не быть никогда).
      ...(this.sunTint.active && { USE_SUN_TINT: '1' })
    }

    this.needsUpdate = true
  }

  public resetMaterial(): void {
    this.uniforms.diffuseMap.value = resourceStorage.getTextureOrMake('default.png')
    this.uniforms.nightMap.value = resourceStorage.getTextureOrMake('night.jpg')
    this.uniforms.cloudMap.value = null
    this.uniforms.specularMap.value = null
    this.uniforms.bumpMap.value = null
    this.uniforms.uBumpTexelSize.value.set(0, 0)
    this.uniforms.uCavityStrength.value = 0

    this.uniforms.uDetailNorMap.value = null
    this.uniforms.uDetailDiffMap.value = null
    this.uniforms.uDetailArmMap.value = null
    this.uniforms.uDetailNor2Map.value = null
    this.uniforms.uDetailLayerGates.value.set(0, 0, 0)

    // Возврат к состоянию «карт нет» — это и есть снимок конструирования:
    // поимённый список дефайнов пришлось бы держать в синхроне вручную при
    // каждом новом слое карт.
    this.defines = { ...this.baseDefines }
    // Снимок конструирования тинта не знает — проводка забывает запись, чтобы
    // ближайший syncSunTint увидел смену и вернул дефайн одним рекомпилом.
    this.sunTint.reset()

    this.needsUpdate = true
  }
}

export { PlanetMaterial }
