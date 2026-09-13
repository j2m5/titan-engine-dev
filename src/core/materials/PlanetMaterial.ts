import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Color, Texture, Uniform, Vector2, Vector3 } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { SLOPE_RANGE, isValidSlopeRange } from '@/core/terrain/slopeMapFormat'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'
import { detailTintNorm } from '@/core/terrain/detailTextureStats'
import { resolveSteepZoneParams } from '@/core/terrain/steepZoneParams'
import { midbandParamsOf } from '@/core/terrain/midbandParams'
import { terrainDataOf } from '@/core/terrain/terrainClassPresets'
import { readWaterLevelMeters } from '@/core/terrain/waterLevel'
import { terrainShadowMapFor } from '@/core/terrain/terrainShadowMap'
import { resolveTerrainLightParams } from '@/core/terrain/terrainLightParams'
import { IPlanetRenderingObject } from '@/core/models/types'
import { readRenderingData } from '@/core/helpers/renderingData'
import { proceduralDiffuseKey } from '@/core/services/ProceduralSurfaceGenerator'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import {
  DETAIL_FADE_START_RATIO,
  macroFadeMetersFor
} from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { SunTintBinding } from '@/core/materials/SunTintBinding'
import { ATMOSPHERE_CATEGORY_ID } from '@/core/constants'
import { resolveStarRadiusKm } from '@/core/terrain/starRadius'
import { penumbraTan } from '@/core/materials/shaders/lib/chunks/terrainShadowMath'

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

  /** Множитель полутени собственной тени рельефа (ручка данных) — читает syncTerrainShadow. */
  private shadowSoftness: number = 1

  /** Радиус звезды системы (юниты сцены) для полутени тел без атмосферы; undefined — фолбэк. */
  private readonly starRadiusUnits: number | undefined

  /** Угловой радиус солнца из данных атмосферы тела; undefined — нет атмосферы. */
  private readonly atmosphereSunAngularRadius: number | undefined

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
    const starRadiusKm = resolveStarRadiusKm(model)
    this.starRadiusUnits = starRadiusKm === undefined ? undefined : toThreeJSUnits(starRadiusKm)
    this.atmosphereSunAngularRadius = atmosphereActor
      ? readRenderingData<AtmosphereConfig>(atmosphereActor)?.sunAngularRadius
      : undefined

    const { uniforms, defines, vertexShader, fragmentShader } = new PlanetShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines
    this.baseDefines = { ...defines }

    // USE_TERRAIN_UV ставится по наличию карты в реестре, а не по типу
    // геометрии: на окно даунгрейда легаси-сфера несёт рельефные дефайны (см.
    // докблок RenderableFactory.swapSurface), а атрибута patchCenter у
    // SphereGeometry нет. Без явного дефолта three не биндит ничего и значение
    // приходит из общего generic-слота GL. Ноль даёт вершиннику
    // normalize(position) — радиаль тело-центричной сферы.
    // midShade: у легаси-сферы окна даунгрейда атрибута нет; y = 0 — доля октав
    // полосы нулевая, fbm наклоняет и красит сам, как до полосы B
    this.defaultAttributeValues = { ...this.defaultAttributeValues, patchCenter: [0, 0, 0], midShade: [0, 0] }

    // Steep-зона материала (Task 3, чанк TerrainDetail — GLSL-сторона уже
    // объявлена задачей 2): второй набор detail-сэмплеров и маска уклона
    // добавляются прямо здесь, а не в PlanetShader — тот несёт только
    // родной detail-слой тела, steep-набор общий на все терраформные тела
    // (см. STEEP_DETAIL_PATHS) и логике конструктора шейдера не принадлежит.
    this.uniforms.uSteepNorMap = new Uniform(null)
    this.uniforms.uSteepArmMap = new Uniform(null)
    this.uniforms.uSteepDiffMap = new Uniform(null)
    this.uniforms.uSteepGate = new Uniform(0)
    this.uniforms.uSteepMask = new Uniform(new Vector3(0.35, 0.55, 0.15))
    this.uniforms.uSteepTint = new Uniform(new Color(0xe7e7e7))
    // Нормировка детальных наборов к их средним (detailTextureStats.ts), 1 = нет
    this.uniforms.uDetailTintNorm = new Uniform(new Vector2(1, 1))
    this.uniforms.uSteepTintNorm = new Uniform(new Vector2(1, 1))

    // Альбедо полосы B от её геометрии: гребни светлее, лощины темнее (ручка
    // пиксельная, в ключ кеша поля высот не входит). Гейт наклона fbm —
    // не юниформ, а доля октав уровня в атрибуте midShade.y.
    this.uniforms.uMidbandShade = new Uniform(midbandParamsOf(model).midbandShade)
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

  /** Полутень тени рельефа: угловой размер солнца — из атмосферы или R★/дистанция; звезда в нуле сцены. */
  public syncTerrainShadow(modelWorldPosition: Vector3): void {
    this.uniforms.uShadowPenumbraTan.value = penumbraTan(
      this.atmosphereSunAngularRadius,
      this.starRadiusUnits,
      modelWorldPosition.length(),
      this.shadowSoftness
    )
  }

  /**
   * Тинт солнца у терминатора — вызывается КАЖДЫЙ видимый кадр (Planet.
   * updateObject, TerrainSphere.onVisibleUpdate); вся механика в SunTintBinding
   * (общей с водной оболочкой), здесь только точка входа материала.
   */
  public syncSunTint(): void {
    this.sunTint.sync()
  }

  /**
   * Ключ диффуза тела: у процедурного (`data.proceduralSurface`) — синтетический
   * ключ рантайм-генератора (`ProceduralSurfaceGenerator.ensureDiffuse` уже
   * зарегистрировал под ним текстуру в resourceStorage к моменту постройки
   * материала — см. TerrainSphere), у обычного — путь ресурса из БД.
   * Отсутствие ресурса — пустая строка: getTextureOrMake находит по ней
   * плейсхолдер, прежнее поведение тел без диффуза.
   */
  private diffuseKey(): string {
    const proceduralSurface = readRenderingData<IPlanetRenderingObject>(this.model)?.proceduralSurface

    if (proceduralSurface) return proceduralDiffuseKey(this.model.getAttribute('id', -1))

    return this.model.resources.where('resourceType', 'diffuse').first()?.getAttribute('path') ?? ''
  }

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
    // Рельефный шейдинг сверяется с фактически загруженной картой высот — тем
    // же реестром, по которому Planet строил геометрию. Строка БД тут не
    // авторитет: если карта не доехала (HeightFieldStorage предупредил и
    // пропустил), сфера гладкая, и кратерный slope-шейдинг на ней был бы
    // враньём — тогда рельефные дефайны молчат целиком.
    const heightPath: string | undefined = heightPathOf(this.model)
    const heightMap = heightPath === undefined ? undefined : heightFieldStorage.get(heightPath)
    const hasHeightField = heightMap !== undefined
    const hasWaterShell = readWaterLevelMeters(this.model) !== undefined

    // slope-карта — уклоны из той же карты высот (см. slopeMapFormat): шейдит
    // попиксельно то, что не влезло в вершинную сетку, мипы фильтруют издалека.
    //
    // Отсутствие строки ресурса — undefined, а не запрос по '': в хранилище
    // живёт плейсхолдер с пустым именем (getTextureOrMake('') у колец), и
    // фолбэк на '' находил бы его как фантомную карту рельефа.
    const textureOf = (
      type: 'detailDiffuse' | 'detailNormal' | 'detailArm' | 'detailNormal2'
    ): Texture | undefined => {
      const path = this.model.resources.where('resourceType', type).first()?.getAttribute('path')

      return typeof path === 'string' ? resourceStorage.getTexture(path) : undefined
    }
    const slopeResource = this.model.resources.where('resourceType', 'slope').first()
    const slopePath = slopeResource?.getAttribute('path')
    const slopeMap = typeof slopePath === 'string' ? resourceStorage.getTexture(slopePath) : undefined
    // Сэмплер bumpMap исторически общий: под USE_SLOPE в него кладётся
    // slope-карта; легаси-путь USE_BUMP вымер вместе с типом ресурса bump.
    const bumpMap: Texture | undefined = hasHeightField ? slopeMap : undefined
    const useSlope = hasHeightField && Boolean(slopeMap)

    // Диапазон декода — per-map поле ресурса (см. slopeMapFormat), отсутствие
    // или невалидное значение (грид степеней двойки) — дефолт SLOPE_RANGE,
    // прежнее поведение тел без ручки.
    const slopeRange = slopeResource?.getAttribute('slopeRange')
    this.uniforms.uSlopeRange.value = isValidSlopeRange(slopeRange) ? slopeRange : SLOPE_RANGE

    // Cavity-затемнение альбедо (арка slope-cavity, канал B slope-карты) —
    // ручка пер-тела, отсутствие поля = 0 (фотомозаичные тела без ручки —
    // cavity им не печётся).
    // Юниформ форвардится из data независимо от гейта ниже: значение само по
    // себе безвредно, шейдер читает его только под USE_CAVITY.
    // Данные облика: пресет класса под данными тела (terrainClassPresets.ts).
    const planetData: IPlanetRenderingObject = terrainDataOf(this.model)
    const cavityStrength = planetData.cavityStrength ?? 0

    // Собственная тень рельефа: карта тени — по карте высот, не по полю (от
    // радиуса и полосы не зависит). Сила — ручка данных, 0 держит шейдер
    // бит-в-бит прежним; юниформ форвардится независимо от гейта.
    const light = resolveTerrainLightParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')
    this.shadowSoftness = light.terrainShadowSoftness
    const useTerrainShadow = hasHeightField && light.terrainShadowStrength > 0
    const shadowMap = useTerrainShadow ? terrainShadowMapFor(heightMap) : undefined
    this.uniforms.uTerrainShadowStrength.value = light.terrainShadowStrength
    this.uniforms.uShadowHeightMap.value = shadowMap?.texture ?? null
    this.uniforms.uShadowHeightMin.value = shadowMap?.heightMinUnits ?? 0
    this.uniforms.uShadowHeightRange.value = shadowMap?.heightRangeUnits ?? 0
    this.uniforms.uShadowTexelAngle.value = shadowMap?.texelAngle ?? 0

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

    // Нормировка к средним файлов: деталь модулирует альбедо вокруг 1, а не
    // умножает на среднюю яркость набора (иначе тело темнеет по мере fade-in)
    const nativeNorm = detailTintNorm(
      this.model.resources.where('resourceType', 'detailDiffuse').first()?.getAttribute('path'),
      this.model.resources.where('resourceType', 'detailArm').first()?.getAttribute('path')
    )
    const steepNorm = detailTintNorm(STEEP_DETAIL_PATHS.diffuse, STEEP_DETAIL_PATHS.arm)
    ;(this.uniforms.uDetailTintNorm.value as Vector2).set(nativeNorm.x, nativeNorm.y)
    ;(this.uniforms.uSteepTintNorm.value as Vector2).set(steepNorm.x, steepNorm.y)

    // Steep-зона материала (Task 3): rocky_trail поверх крутых склонов ЛЮБОГО
    // терраформного тела (решение владельца, см. STEEP_DETAIL_PATHS). Гейт
    // открыт только когда набор ПОЛНЫЙ (все три текстуры доехали от
    // стримера) И родной detailDiffuse тела — это НЕ сам steep-набор: у Луны
    // родной набор уже rocky_trail, второй проход тем же набором был бы
    // бессмысленной двойной выборкой.
    const steepNorMap = resourceStorage.getTexture(STEEP_DETAIL_PATHS.normal)
    const steepArmMap = resourceStorage.getTexture(STEEP_DETAIL_PATHS.arm)
    const steepDiffMap = resourceStorage.getTexture(STEEP_DETAIL_PATHS.diffuse)
    const nativeDetailDiffusePath = this.model.resources.where('resourceType', 'detailDiffuse').first()?.getAttribute('path')
    const steepSetComplete = Boolean(steepNorMap) && Boolean(steepArmMap) && Boolean(steepDiffMap)

    this.uniforms.uSteepNorMap.value = steepNorMap ?? null
    this.uniforms.uSteepArmMap.value = steepArmMap ?? null
    this.uniforms.uSteepDiffMap.value = steepDiffMap ?? null
    this.uniforms.uSteepGate.value = steepSetComplete && nativeDetailDiffusePath !== STEEP_DETAIL_PATHS.diffuse ? 1 : 0

    // Маска зависит только от ручек данных (context = имя тела, как у прочих
    // громких ошибок материала) — резолвится безусловно, независимо от гейта,
    // тем же паттерном, что uCavityStrength/uSlopeRange выше. Опциональный
    // вызов: минимальные стаб-акторы других спеков этого пакета не несут
    // getAttribute на верхнем уровне (только renderingObject/physicalObject/
    // children/resources) — материал не обязан требовать больше того, что уже
    // требовал ДО этой задачи.
    const steepZoneParams = resolveSteepZoneParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')
    ;(this.uniforms.uSteepMask.value as Vector3).set(
      steepZoneParams.steepStart,
      steepZoneParams.steepFull,
      steepZoneParams.steepBreakup
    )
    ;(this.uniforms.uSteepTint.value as Color).copy(steepZoneParams.steepTint)

    // Тексель диффуза для варпа средней полосы — только у ЗАГРУЖЕННОЙ карты
    // (плейсхолдер размером не является): нули выключают варп, а не врут.
    const loadedDiffuse = resourceStorage.getTexture(this.diffuseKey())?.image as
      | { width?: number; height?: number }
      | undefined
    this.uniforms.uDiffuseTexelSize.value.set(
      loadedDiffuse?.width ? 1 / loadedDiffuse.width : 0,
      loadedDiffuse?.height ? 1 / loadedDiffuse.height : 0
    )

    // Конец fade полосы по умолчанию считается от ширины диффуза, а диффуз
    // приезжает сюда, а не в конструктор шейдера (там ширина ещё 0 и диапазон
    // вырождался в 1e-6 — полоса не рисовалась никогда). Явная ручка
    // macroFadeMeters расчёт перекрывает и от загрузки карты не зависит.
    const radiusKm: number = this.model.physicalObject?.getAttribute('radius') ?? 0
    const macroFadeEndUnits = Math.max(
      toThreeJSUnits((planetData.macroFadeMeters ?? macroFadeMetersFor(radiusKm, loadedDiffuse?.width ?? 0)) / 1000),
      1e-6
    )
    this.uniforms.uMacroFadeRange.value.set(macroFadeEndUnits * DETAIL_FADE_START_RATIO, macroFadeEndUnits)

    const macroStrength = planetData.macroStrength ?? 0

    // Набор собирается от снимка конструирования, а не поверх прошлого: только
    // так дефайн ушедшей карты исчезает вместе с ней (см. baseDefines).
    this.defines = {
      ...this.baseDefines,
      ...(useSlope && { USE_SLOPE: '1' }),
      // Попиксельный UV из направления вместо вершинного vUv — вершинная
      // развёртка кубосферы вырождается у полюсов (см. PlanetShaderTemplate).
      // Тот же реестр карт высот, что решает геометрию TerrainSphere.
      ...(hasHeightField && { USE_TERRAIN_UV: '1' }),
      ...(USE_TERRAIN_DETAIL && { USE_TERRAIN_DETAIL: '1' }),
      // Гейт: тот же slope, что USE_SLOPE (без него канал B недоступен), И
      // ненулевая ручка — при cavityStrength 0 путь бит-в-бит прежним.
      ...(useSlope && cavityStrength > 0 && { USE_CAVITY: '1' }),
      // Средняя полоса детали: тот же slope-гейт (амплитуда подчинена уклону
      // и cavity) И ненулевая ручка — при macroStrength 0 путь бит-в-бит прежним.
      ...(useSlope && macroStrength > 0 && { USE_TERRAIN_MACRO_DETAIL: '1' }),
      // Мокрая кромка берега: атрибут height есть у ЛЮБОГО патча (не только
      // с полосой) — реальная зависимость от USE_TERRAIN_MACRO_DETAIL это
      // uMacroFadeRange (fade кромки читает чанк полосы); при macroStrength 0
      // кромка выключается вместе с полосой.
      ...(useSlope && macroStrength > 0 && hasWaterShell && { USE_WATER_EDGE: '1' }),
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
      // Тень облаков на земле: нужна и облачная карта (вторая выборка cloudMap),
      // и рельефный путь — сдвиг uv считается в ветке USE_TERRAIN_UV, у легаси-
      // сферы этого кода нет. Пара с USE_CLOUD держится тем же cloudMap.
      ...(cloudMap && hasHeightField && { USE_CLOUD_SHADOW: '1' }),
      // Тень рельефа: карта высот есть И ручка ненулевая — при 0 шейдер бит-в-бит прежний
      ...(useTerrainShadow && { USE_TERRAIN_SHADOW: '1' }),
      // Пересборка от снимка стирает и дефайны атмосферных LUT — они не про
      // карты и живут своей синхронизацией, поэтому восстанавливаются здесь же
      // по текущей записи реестра (иначе стриминг карт гасил бы тинт до
      // следующей смены записи, которой может не быть никогда). Пара
      // USE_SUN_TINT / USE_SKY_AMBIENT неразрывна: обе таблицы приходят одной
      // записью реестра.
      ...(this.sunTint.active && { USE_SUN_TINT: '1', USE_SKY_AMBIENT: '1' }),
      // Процедурная деталь облаков гиганта — только легаси-сфера: у тела с
      // загруженной картой высот ветка #else шаблона вообще не компилируется
      // (UV идёт через terrainUv), а домен детали построен на body-локальном
      // vPosition той же ветки.
      ...(planetData.giantDetail === true && !hasHeightField && { USE_GIANT_DETAIL: '1' })
    }

    this.needsUpdate = true
  }

  public resetMaterial(): void {
    this.uniforms.diffuseMap.value = resourceStorage.getTextureOrMake('default.png')
    this.uniforms.nightMap.value = resourceStorage.getTextureOrMake('night.jpg')
    this.uniforms.cloudMap.value = null
    this.uniforms.specularMap.value = null
    this.uniforms.bumpMap.value = null
    this.uniforms.uDiffuseTexelSize.value.set(0, 0)
    this.uniforms.uCavityStrength.value = 0
    this.uniforms.uSlopeRange.value = SLOPE_RANGE

    this.uniforms.uDetailNorMap.value = null
    this.uniforms.uDetailDiffMap.value = null
    this.uniforms.uDetailArmMap.value = null
    this.uniforms.uDetailNor2Map.value = null
    this.uniforms.uDetailLayerGates.value.set(0, 0, 0)

    this.uniforms.uSteepNorMap.value = null
    this.uniforms.uSteepArmMap.value = null
    this.uniforms.uSteepDiffMap.value = null
    this.uniforms.uSteepGate.value = 0

    this.uniforms.uShadowHeightMap.value = null
    this.uniforms.uShadowHeightMin.value = 0
    this.uniforms.uShadowHeightRange.value = 0
    this.uniforms.uShadowTexelAngle.value = 0
    ;(this.uniforms.uDetailTintNorm.value as Vector2).set(1, 1)
    ;(this.uniforms.uSteepTintNorm.value as Vector2).set(1, 1)

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
