import { Actor } from '@/core/models/Actor'
import { TerrainShader } from '@/core/materials/shaders/TerrainShader'
import { PlanetSurfaceMaterial, type SurfaceMaps } from '@/core/materials/PlanetSurfaceMaterial'
import { Color, Texture, Uniform, Vector2, Vector3, Vector4 } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { SLOPE_RANGE, isValidSlopeRange } from '@/core/terrain/slopeMapFormat'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'
import { detailTintNorm } from '@/core/terrain/detailTextureStats'
import { resolveSteepZoneParams } from '@/core/terrain/steepZoneParams'
import { resolveFrostParams } from '@/core/terrain/frostParams'
import { midbandParamsOf } from '@/core/terrain/midbandParams'
import { readWaterLevelMeters } from '@/core/terrain/waterLevel'
import { onTerrainShadowMapReady, terrainShadowMapFor, type TerrainShadowMap } from '@/core/terrain/terrainShadowMap'
import { resolveTerrainLightParams } from '@/core/terrain/terrainLightParams'
import type { NearTileState } from '@/core/terrain/NearShadowTile'
import { readRenderingData } from '@/core/helpers/renderingData'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import {
  DETAIL_FADE_START_RATIO,
  macroFadeMetersFor
} from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { resolveStarRadiusKm } from '@/core/terrain/starRadius'
import { penumbraTan } from '@/core/materials/shaders/lib/chunks/terrainShadowMath'

/**
 * Материал патчей рельефа (TerrainSphere): slope/cavity, детальный слой и
 * steep-зона, средняя полоса, мокрая кромка, тень облаков, собственная тень
 * рельефа (дальняя карта и ближняя плитка), блеск льда, иней.
 */
class TerrainMaterial extends PlanetSurfaceMaterial {
  /** Множитель полутени собственной тени рельефа (ручка данных) — читает syncTerrainShadow. */
  private shadowSoftness: number = 1

  /** Сила ближнего слоя тени (ручка данных) — множитель веса в setNearTile. */
  private nearShadowStrength: number = 1

  /** Отписка от готовности карты тени: до неё привязана заглушка, см. terrainShadowMapFor. */
  private unsubscribeShadowReady: (() => void) | null = null

  /** Радиус звезды системы (юниты сцены) для полутени тел без атмосферы; undefined — фолбэк. */
  private readonly starRadiusUnits: number | undefined

  /** Угловой радиус солнца из данных атмосферы тела; undefined — нет атмосферы. */
  private readonly atmosphereSunAngularRadius: number | undefined

  public constructor(model: Actor, atmosphereRegistry?: AtmosphereRegistry) {
    super(model, atmosphereRegistry, new TerrainShader(model))
    const starRadiusKm = resolveStarRadiusKm(model)
    this.starRadiusUnits = starRadiusKm === undefined ? undefined : toThreeJSUnits(starRadiusKm)
    this.atmosphereSunAngularRadius = this.atmosphereActor
      ? readRenderingData<AtmosphereConfig>(this.atmosphereActor)?.sunAngularRadius
      : undefined

    // Страховка атрибутов патча: без явного дефолта three не биндит ничего, и
    // значение приходит из общего generic-слота GL. Нули — своя форма патча:
    // patchCenter 0 даёт вершиннику normalize(position), midShade.y 0 — доля
    // октав полосы нулевая, морф-атрибуты (только у морф-пула) — без морфа.
    this.defaultAttributeValues = {
      ...this.defaultAttributeValues,
      patchCenter: [0, 0, 0],
      midShade: [0, 0],
      morphDelta: [0, 0, 0],
      patchMorph: [0],
      midShadeParent: [0, 0],
      midTiltParent: [0, 0]
    }

    // Steep-зона (чанк TerrainDetail): второй набор detail-сэмплеров и маска
    // уклона — юниформы материала: steep-набор общий на все терраформные тела
    // (см. STEEP_DETAIL_PATHS), не данные шейдера тела.
    this.uniforms.uSteepNorMap = new Uniform(null)
    this.uniforms.uSteepArmMap = new Uniform(null)
    this.uniforms.uSteepDiffMap = new Uniform(null)
    this.uniforms.uSteepGate = new Uniform(0)
    this.uniforms.uSteepMask = new Uniform(new Vector3(0.35, 0.55, 0.15))
    this.uniforms.uSteepTint = new Uniform(new Color(0xe7e7e7))
    // Иней (frostParams.ts): значения ставит updateMaterial, здесь — дефолты
    this.uniforms.uFrostStrength = new Uniform(0)
    this.uniforms.uFrostLine = new Uniform(new Vector4(0, 500, 0, 0))
    this.uniforms.uFrostSlopeMax = new Uniform(0.6)
    this.uniforms.uFrostColor = new Uniform(new Color(0xf0f2f5))
    // Нормировка детальных наборов к их средним (detailTextureStats.ts), 1 = нет
    this.uniforms.uDetailTintNorm = new Uniform(new Vector2(1, 1))
    this.uniforms.uSteepTintNorm = new Uniform(new Vector2(1, 1))

    // Альбедо полосы B от её геометрии: гребни светлее, лощины темнее (ручка
    // пиксельная, в ключ кеша поля высот не входит). Гейт наклона fbm —
    // не юниформ, а доля октав уровня в атрибуте midShade.y.
    this.uniforms.uMidbandShade = new Uniform(midbandParamsOf(model).midbandShade)
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

  /** Нужна ли плитка ближней тени: слой живёт внутри USE_TERRAIN_SHADOW и гаснет при силе 0. */
  public get nearShadowActive(): boolean {
    return this.defines.USE_TERRAIN_SHADOW !== undefined && this.nearShadowStrength > 0
  }

  /** Плитка ближней тени (NearShadowTile); null — вес 0, вывод шейдера прежний. Текстурой владеет плитка. */
  public setNearTile(state: NearTileState | null): void {
    const u = this.uniforms
    if (!state) {
      u.uNearTile.value = null
      u.uNearTileWeight.value = 0
      ;(u.uNearCameraXY.value as Vector2).set(0, 0)

      return
    }
    u.uNearTile.value = state.texture
    ;(u.uNearTileCenter.value as Vector3).fromArray(state.center)
    ;(u.uNearTileEast.value as Vector3).fromArray(state.east)
    ;(u.uNearTileNorth.value as Vector3).fromArray(state.north)
    u.uNearTileTexelMeters.value = state.texelMeters
    u.uNearTileTexels.value = state.texels
    u.uNearTileWeight.value = state.altitudeWeight * this.nearShadowStrength
    // каждый кадр: окно веса едет с камерой между перепечками
    ;(u.uNearCameraXY.value as Vector2).fromArray(state.cameraXY)
  }

  protected updatePath({ planetData, cloudMap }: SurfaceMaps): Record<string, string> {
    // Рельефный шейдинг сверяется с фактически загруженной картой высот — тем
    // же реестром, по которому строилась геометрия. Строка БД тут не
    // авторитет: если карты нет, рельефные дефайны молчат целиком.
    const heightPath: string | undefined = heightPathOf(this.model)
    const heightMap = heightPath === undefined ? undefined : heightFieldStorage.get(heightPath)
    const hasHeightField = heightMap !== undefined
    const hasWaterShell = readWaterLevelMeters(this.model) !== undefined

    // slope-карта — уклоны из той же карты высот (см. slopeMapFormat): шейдит
    // попиксельно то, что не влезло в вершинную сетку, мипы фильтруют издалека.
    //
    // Нет строки ресурса — нет и запроса: пустой путь ключом карты не является.
    const textureOf = (
      type: 'detailDiffuse' | 'detailNormal' | 'detailArm' | 'detailNormal2'
    ): Texture | undefined => {
      const path = this.model.resources.where('resourceType', type).first()?.getAttribute('path')

      return typeof path === 'string' ? resourceStorage.getTexture(path) : undefined
    }
    const slopeResource = this.model.resources.where('resourceType', 'slope').first()
    const slopePath = slopeResource?.getAttribute('path')
    const slopeMap = typeof slopePath === 'string' ? resourceStorage.getTexture(slopePath) : undefined
    // Под USE_SLOPE в сэмплер bumpMap кладётся slope-карта
    const bumpMap: Texture | undefined = hasHeightField ? slopeMap : undefined
    const useSlope = hasHeightField && Boolean(slopeMap)

    // Диапазон декода — per-map поле ресурса (см. slopeMapFormat); отсутствие
    // или невалидное значение (грид степеней двойки) — дефолт SLOPE_RANGE.
    const slopeRange = slopeResource?.getAttribute('slopeRange')
    this.uniforms.uSlopeRange.value = isValidSlopeRange(slopeRange) ? slopeRange : SLOPE_RANGE

    // Cavity-затемнение (канал B slope-карты) — ручка тела, отсутствие поля = 0.
    // Форвардится без гейта: шейдер читает её только под USE_CAVITY.
    const cavityStrength = planetData.cavityStrength ?? 0
    this.uniforms.uCavityStrength.value = cavityStrength

    // Собственная тень рельефа: карта тени — по карте высот, не по полю (от
    // радиуса и полосы не зависит). Сила — ручка данных, 0 держит шейдер
    // бит-в-бит прежним; юниформ форвардится независимо от гейта.
    const light = resolveTerrainLightParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')
    this.shadowSoftness = light.terrainShadowSoftness
    this.nearShadowStrength = light.nearShadowStrength
    const useTerrainShadow = hasHeightField && light.terrainShadowStrength > 0
    const shadowMap = useTerrainShadow ? terrainShadowMapFor(heightMap) : undefined
    this.uniforms.uTerrainShadowStrength.value = light.terrainShadowStrength
    this.uniforms.uIceGlintStrength.value = light.iceGlintStrength
    this.bindShadowMap(shadowMap)
    this.unsubscribeShadowReady?.()
    this.unsubscribeShadowReady =
      shadowMap && heightMap && !shadowMap.ready
        ? onTerrainShadowMapReady(heightMap, (ready) => this.bindShadowMap(ready))
        : null

    // Детальный слой (чанк TerrainDetail): крупная нормаль — база слоя, её
    // наличие и есть условие USE_TERRAIN_DETAIL. AO/diffuse/мелкая нормаль
    // опциональны — гейтятся рантайм-юниформом uDetailLayerGates, а не
    // #ifdef, чтобы догрузка отдельной карты не требовала перекомпиляции.
    const detailNorMap = textureOf('detailNormal')
    const detailDiffMap = textureOf('detailDiffuse')
    const detailArmMap = textureOf('detailArm')
    const detailNor2Map = textureOf('detailNormal2')
    const USE_TERRAIN_DETAIL = hasHeightField && Boolean(detailNorMap)

    this.uniforms.bumpMap.value = bumpMap

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

    // Steep-зона: rocky_trail поверх крутых склонов любого терраформного тела
    // (см. STEEP_DETAIL_PATHS). Гейт открыт только когда набор полный (все три
    // текстуры доехали) И родной detailDiffuse тела — не сам steep-набор (у
    // Луны родной набор уже rocky_trail, второй проход был бы двойной выборкой).
    const steepNorMap = resourceStorage.getTexture(STEEP_DETAIL_PATHS.normal)
    const steepArmMap = resourceStorage.getTexture(STEEP_DETAIL_PATHS.arm)
    const steepDiffMap = resourceStorage.getTexture(STEEP_DETAIL_PATHS.diffuse)
    const nativeDetailDiffusePath = this.model.resources.where('resourceType', 'detailDiffuse').first()?.getAttribute('path')
    const steepSetComplete = Boolean(steepNorMap) && Boolean(steepArmMap) && Boolean(steepDiffMap)

    this.uniforms.uSteepNorMap.value = steepNorMap ?? null
    this.uniforms.uSteepArmMap.value = steepArmMap ?? null
    this.uniforms.uSteepDiffMap.value = steepDiffMap ?? null
    this.uniforms.uSteepGate.value = steepSetComplete && nativeDetailDiffusePath !== STEEP_DETAIL_PATHS.diffuse ? 1 : 0

    // Маска зависит только от ручек данных (context = имя тела) — резолвится
    // безусловно, независимо от гейта. Опциональный getAttribute: стаб-акторы
    // спеков не несут его на верхнем уровне.
    const steepZoneParams = resolveSteepZoneParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')
    ;(this.uniforms.uSteepMask.value as Vector3).set(
      steepZoneParams.steepStart,
      steepZoneParams.steepFull,
      steepZoneParams.steepBreakup
    )
    ;(this.uniforms.uSteepTint.value as Color).copy(steepZoneParams.steepTint)

    // Иней (frostParams.ts): та же безусловная резолвка ручек данных, гейт
    // ниже требует ещё slope-карту (terrainMapSlopeVec экспозиции).
    const frost = resolveFrostParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')
    this.uniforms.uFrostStrength.value = frost.frostStrength
    ;(this.uniforms.uFrostLine.value as Vector4).set(frost.frostLineMeters, frost.frostLineWidthMeters, frost.frostPolarDropMeters, frost.frostAspectMeters)
    this.uniforms.uFrostSlopeMax.value = frost.frostSlopeMax
    ;(this.uniforms.uFrostColor.value as Color).copy(frost.frostColor)

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
    // приезжает сюда, а не в конструктор шейдера (там ширина ещё 0). Явная
    // ручка macroFadeMeters расчёт перекрывает и от загрузки карты не зависит.
    const radiusKm: number = this.model.physicalObject?.getAttribute('radius') ?? 0
    const macroFadeEndUnits = Math.max(
      toThreeJSUnits((planetData.macroFadeMeters ?? macroFadeMetersFor(radiusKm, loadedDiffuse?.width ?? 0)) / 1000),
      1e-6
    )
    this.uniforms.uMacroFadeRange.value.set(macroFadeEndUnits * DETAIL_FADE_START_RATIO, macroFadeEndUnits)

    const macroStrength = planetData.macroStrength ?? 0

    // USE_SPECULAR (блик воды по specular-карте) — только у сферы: у рельефа блик даёт водная оболочка
    return {
      ...(useSlope && { USE_SLOPE: '1' }),
      ...(USE_TERRAIN_DETAIL && { USE_TERRAIN_DETAIL: '1' }),
      // Гейт: тот же slope, что USE_SLOPE (без него канал B недоступен), И
      // ненулевая ручка — при cavityStrength 0 путь бит-в-бит прежним.
      ...(useSlope && cavityStrength > 0 && { USE_CAVITY: '1' }),
      // Средняя полоса детали: тот же slope-гейт (амплитуда подчинена уклону
      // и cavity) И ненулевая ручка — при macroStrength 0 путь бит-в-бит прежним.
      ...(useSlope && macroStrength > 0 && { USE_TERRAIN_MACRO_DETAIL: '1' }),
      // Мокрая кромка берега: fade кромки читает uMacroFadeRange чанка полосы —
      // при macroStrength 0 кромка выключается вместе с полосой.
      ...(useSlope && macroStrength > 0 && hasWaterShell && { USE_WATER_EDGE: '1' }),
      // Тень облаков на земле: вторая выборка cloudMap (пара с USE_CLOUD) на рельефе
      ...(cloudMap && hasHeightField && { USE_CLOUD_SHADOW: '1' }),
      // Тень рельефа: карта высот есть И ручка ненулевая — при 0 шейдер бит-в-бит прежний
      ...(useTerrainShadow && { USE_TERRAIN_SHADOW: '1' }),
      // Блеск льда: слой детали даёт шероховатость; на телах с водой блик суши под водой был бы вторым бликом
      ...(USE_TERRAIN_DETAIL && light.iceGlintStrength > 0 && !hasWaterShell && { USE_TERRAIN_GLINT: '1' }),
      // Иней: нужны высота карты и её уклон (slope-карта); сила 0 держит шейдер прежним
      ...(hasHeightField && useSlope && frost.frostStrength > 0 && { USE_TERRAIN_FROST: '1' })
    }
  }

  public override dispose(): void {
    this.unsubscribeShadowReady?.()
    this.unsubscribeShadowReady = null
    super.dispose()
  }

  private bindShadowMap(shadowMap: TerrainShadowMap | undefined): void {
    this.uniforms.uShadowHeightMap.value = shadowMap?.texture ?? null
    this.uniforms.uShadowHeightMin.value = shadowMap?.heightMinUnits ?? 0
    this.uniforms.uShadowHeightRange.value = shadowMap?.heightRangeUnits ?? 0
    this.uniforms.uShadowTexelAngle.value = shadowMap?.texelAngle ?? 0
  }

  protected resetPath(): void {
    this.uniforms.bumpMap.value = null
    this.uniforms.uCavityStrength.value = 0
    this.uniforms.uDiffuseTexelSize.value.set(0, 0)
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

    this.unsubscribeShadowReady?.()
    this.unsubscribeShadowReady = null
    this.bindShadowMap(undefined)
    this.setNearTile(null)
    ;(this.uniforms.uDetailTintNorm.value as Vector2).set(1, 1)
    ;(this.uniforms.uSteepTintNorm.value as Vector2).set(1, 1)
  }
}

export { TerrainMaterial }
