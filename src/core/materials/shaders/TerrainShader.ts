import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { Texture, Uniform, Vector2, Vector3, Vector4 } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'
import {
  DETAIL_FADE_START_RATIO,
  macroFadeMetersFor
} from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'
import { DEFAULT_DETAIL_SCALE2_METERS, DEFAULT_DETAIL_SCALE_METERS, validPeriodMeters } from '@/core/terrain/detailWrap'
import { resolveMacroSlopeStructureParams } from '@/core/terrain/macroSlopeStructureParams'
import { resolveWaterFoamParams } from '@/core/terrain/waterFoamParams'
import { readWaterLevelMeters } from '@/core/terrain/waterLevel'
import { config } from '@/core/framework/config'
import { DEFAULT_SUN_ANGULAR_RADIUS } from '@/core/materials/shaders/lib/chunks/terrainShadowMath'
import { PlanetSurfaceShader, PlanetSurfaceUniforms } from '@/core/materials/shaders/PlanetSurfaceShader'

// Нейтральные дефолты детального слоя — только если данные тела не задали
// ручку явно (IPlanetRenderingObject.detail*, ручки Луны в renderingObjects.ts).
const DEFAULT_DETAIL_NORMAL_SCALE = 1
const DEFAULT_DETAIL_SATURATION = 0.15
const DEFAULT_DETAIL_BRIGHTNESS = 1
const DEFAULT_DETAIL_AO_INFLUENCE = 0.5

// Конец fade шкалы (м дистанции камеры): на 30000 м период крупной шкалы
// (40 м) опускается ниже ~1 пикселя (1080p, fov ~50°), на 5000 м — мелкой (7 м).
// Начало fade — общая с CPU-зеркалом доля DETAIL_FADE_START_RATIO.
const DEFAULT_DETAIL_FADE_METERS = 30000
const DEFAULT_DETAIL_FADE2_METERS = 5000

// Средняя полоса детали (чанк TerrainMacroDetail): strength 0 = выключено
// (дефайн не ставится). Период 3 км — между текселем диффуза (~1–5 км) и
// крупной шкалой TerrainDetail (40 м).
const DEFAULT_MACRO_STRENGTH = 0
const DEFAULT_MACRO_SCALE_KM = 3
const DEFAULT_MACRO_NORMAL_SCALE = 1
const DEFAULT_MACRO_SLOPE_INFLUENCE = 0.6
const DEFAULT_MACRO_CAVITY_INFLUENCE = 0.5
const DEFAULT_MACRO_TEXTURE_WARP = 1.5
// Уклон (tan) полной амплитуды полосы: у километровых текселей уклоны на
// порядок ниже потолка кодировки SLOPE_RANGE — нормировка по нему обнуляла бы гейт.
const DEFAULT_MACRO_SLOPE_REF = 0.08

// Период (м) → масштаб трипланарной проекции: чанк TerrainDetail умножает
// домен на 1/период; гард только от деления на 0 у мусорных данных.
function detailPeriodToScale(periodMeters: number): number {
  const periodUnits = toThreeJSUnits(periodMeters / 1000)

  return periodUnits > 0 ? 1 / periodUnits : 0
}

export interface TerrainUniforms extends PlanetSurfaceUniforms {
  uDetailDiffMap: Texture | null
  uDetailNorMap: Texture | null
  uDetailArmMap: Texture | null
  uDetailNor2Map: Texture | null
  uDetailScale: number
  uDetailScale2: number
  uDetailNormalScale: number
  uDetailSaturation: number
  uDetailBrightness: number
  uDetailAoInfluence: number
  uDetailLayerGates: Vector3
  uDetailFadeRange: Vector4
  uSlopeRange: number
  uShadowHeightMap: Texture | null
  uShadowHeightMin: number
  uShadowHeightRange: number
  uShadowTexelAngle: number
  uShadowMaxDistUnits: number
  uShadowPenumbraTan: number
  uTerrainShadowStrength: number
  uNearTile: Texture | null
  uNearTileCenter: Vector3
  uNearTileEast: Vector3
  uNearTileNorth: Vector3
  uNearTileTexelMeters: number
  uNearTileTexels: number
  uNearTileWeight: number
  uNearShadowMaxDistMeters: number
  uBodyRadiusMeters: number
  uIceGlintStrength: number
  uMacroStrength: number
  uMacroNormalScale: number
  uMacroPeriodUnits: number
  uMacroSlopeInfluence: number
  uMacroSlopeRef: number
  uMacroCavityInfluence: number
  uMacroTextureWarp: number
  uMacroFadeRange: Vector2
  uMacroStreakStrength: number
  uMacroStreakPeriodUnits: number
  uMacroTerraceStrength: number
  uMacroTerraceStepMeters: number
  uMacroStructureSlope: Vector2
  uMacroStreakChart: number
  uDiffuseTexelSize: Vector2
  uWaterLevelMeters: number
  uWetBandMeters: number
  uWetDarken: number
}

export type TerrainUniformKey = keyof TerrainUniforms

/** Юниформы патчей рельефа: общие плюс деталь, средняя полоса, тени, мокрая кромка. */
class TerrainShader extends PlanetSurfaceShader<TerrainUniformKey> {
  public constructor(model: Actor) {
    super(model, TerrainShaderTemplate, 'TerrainShader')
    const planetData = this.planetData
    const radiusKm = this.radiusKm
    const light = this.light

    const detailFadeEndUnits = toThreeJSUnits(
      (planetData.detailFadeMeters ?? DEFAULT_DETAIL_FADE_METERS) / 1000
    )
    const detailFade2EndUnits = toThreeJSUnits(
      (planetData.detailFade2Meters ?? DEFAULT_DETAIL_FADE2_METERS) / 1000
    )

    // Конец fade полосы: явная ручка или расчёт от текселя диффуза. Ширина
    // берётся у ЗАГРУЖЕННОЙ карты (getTexture, не плейсхолдер); пока карты
    // нет — 0 → кламп положительным минимумом (деление на 0 в smoothstep).
    const diffusePath: string = this.model.resources.where('resourceType', 'diffuse').first()?.getAttribute('path') ?? ''
    const diffuseWidth: number = (resourceStorage.getTexture(diffusePath)?.image as { width?: number } | undefined)?.width ?? 0
    const macroFadeEndUnits = Math.max(
      toThreeJSUnits((planetData.macroFadeMeters ?? macroFadeMetersFor(radiusKm, diffuseWidth)) / 1000),
      1e-6
    )

    const slopeStructures = resolveMacroSlopeStructureParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')
    const foam = resolveWaterFoamParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')
    const waterLevelMeters = readWaterLevelMeters(this.model) ?? 0

    this.uniforms = {
      ...this.surfaceUniforms,
      uDetailDiffMap: new Uniform(null),
      uDetailNorMap: new Uniform(null),
      uDetailArmMap: new Uniform(null),
      uDetailNor2Map: new Uniform(null),
      uDetailScale: new Uniform(detailPeriodToScale(validPeriodMeters(planetData.detailScaleMeters, DEFAULT_DETAIL_SCALE_METERS))),
      uDetailScale2: new Uniform(detailPeriodToScale(validPeriodMeters(planetData.detailScale2Meters, DEFAULT_DETAIL_SCALE2_METERS))),
      uDetailNormalScale: new Uniform(planetData.detailNormalScale ?? DEFAULT_DETAIL_NORMAL_SCALE),
      uDetailSaturation: new Uniform(planetData.detailSaturation ?? DEFAULT_DETAIL_SATURATION),
      uDetailBrightness: new Uniform(planetData.detailBrightness ?? DEFAULT_DETAIL_BRIGHTNESS),
      uDetailAoInfluence: new Uniform(planetData.detailAoInfluence ?? DEFAULT_DETAIL_AO_INFLUENCE),
      uDetailLayerGates: new Uniform(new Vector3(0, 0, 0)),
      uDetailFadeRange: new Uniform(
        new Vector4(
          detailFadeEndUnits * DETAIL_FADE_START_RATIO,
          detailFadeEndUnits,
          detailFade2EndUnits * DETAIL_FADE_START_RATIO,
          detailFade2EndUnits
        )
      ),
      // Per-map диапазон декода (строка slope-ресурса) ставит материал; здесь дефолт до загрузки
      uSlopeRange: new Uniform(SLOPE_RANGE),
      // Тень рельефа: карту и масштабы привязывает материал, полутень — syncTerrainShadow;
      // здесь дефолты до первой карты
      uShadowHeightMap: new Uniform(null),
      uShadowHeightMin: new Uniform(0),
      uShadowHeightRange: new Uniform(0),
      uShadowTexelAngle: new Uniform(0),
      uShadowMaxDistUnits: new Uniform(toThreeJSUnits(config('terrain.shadowMaxKm'))),
      uShadowPenumbraTan: new Uniform(Math.tan(DEFAULT_SUN_ANGULAR_RADIUS)),
      uTerrainShadowStrength: new Uniform(light.terrainShadowStrength),
      // Ближний слой тени: плитку ставит материал (setNearTile); вес 0 — слоя нет
      uNearTile: new Uniform(null),
      uNearTileCenter: new Uniform(new Vector3(1, 0, 0)),
      uNearTileEast: new Uniform(new Vector3(0, 0, -1)),
      uNearTileNorth: new Uniform(new Vector3(0, 1, 0)),
      uNearTileTexelMeters: new Uniform(config('terrain.nearShadow').texelMeters),
      uNearTileTexels: new Uniform(config('terrain.nearShadow').tileTexels),
      uNearTileWeight: new Uniform(0),
      uNearShadowMaxDistMeters: new Uniform(config('terrain.nearShadow').maxDistanceMeters),
      uBodyRadiusMeters: new Uniform(radiusKm * 1000),
      uIceGlintStrength: new Uniform(light.iceGlintStrength),
      uMacroStrength: new Uniform(planetData.macroStrength ?? DEFAULT_MACRO_STRENGTH),
      uMacroNormalScale: new Uniform(planetData.macroNormalScale ?? DEFAULT_MACRO_NORMAL_SCALE),
      // Кламп положительным минимумом: период — знаменатель домена в чанке
      uMacroPeriodUnits: new Uniform(Math.max(toThreeJSUnits(planetData.macroScaleKm ?? DEFAULT_MACRO_SCALE_KM), 1e-9)),
      uMacroSlopeInfluence: new Uniform(planetData.macroSlopeInfluence ?? DEFAULT_MACRO_SLOPE_INFLUENCE),
      // Кламп положительным минимумом: опорный уклон — знаменатель гейта в чанке
      uMacroSlopeRef: new Uniform(Math.max(planetData.macroSlopeRef ?? DEFAULT_MACRO_SLOPE_REF, 1e-3)),
      uMacroCavityInfluence: new Uniform(planetData.macroCavityInfluence ?? DEFAULT_MACRO_CAVITY_INFLUENCE),
      uMacroTextureWarp: new Uniform(planetData.macroTextureWarp ?? DEFAULT_MACRO_TEXTURE_WARP),
      uMacroFadeRange: new Uniform(new Vector2(macroFadeEndUnits * DETAIL_FADE_START_RATIO, macroFadeEndUnits)),
      uMacroStreakStrength: new Uniform(slopeStructures.macroStreakStrength),
      uMacroStreakPeriodUnits: new Uniform(Math.max(toThreeJSUnits(slopeStructures.macroStreakScaleKm), 1e-9)),
      uMacroTerraceStrength: new Uniform(slopeStructures.macroTerraceStrength),
      uMacroTerraceStepMeters: new Uniform(slopeStructures.macroTerraceStepMeters),
      uMacroStructureSlope: new Uniform(new Vector2(slopeStructures.macroStructureSlopeStart, slopeStructures.macroStructureSlopeFull)),
      uMacroStreakChart: new Uniform(slopeStructures.macroStreakChart),
      uDiffuseTexelSize: new Uniform(new Vector2()),
      // Мокрая кромка берега — инертна без USE_WATER_EDGE
      uWaterLevelMeters: new Uniform(waterLevelMeters),
      uWetBandMeters: new Uniform(foam.terrainWetBandMeters),
      uWetDarken: new Uniform(foam.terrainWetDarken)
    }
  }
}

export { TerrainShader }
