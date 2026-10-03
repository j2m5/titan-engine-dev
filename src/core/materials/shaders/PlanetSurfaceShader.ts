import { AbstractShader, ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { IUniform, Texture, Uniform, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { IPlanetRenderingObject, IRingRenderingObject } from '@/core/models/types'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { clampSunTintStrength } from '@/core/materials/SunTintBinding'
import { regolithParamsOf } from '@/core/terrain/regolithParams'
import { resolveTerrainLightParams, TerrainLightParams } from '@/core/terrain/terrainLightParams'
import { terrainDataOf } from '@/core/terrain/terrainClassPresets'

// Ламберт суши: 1 — окклюзия (cavity/AO) живёт внутри mix(…, uTerrainLambert),
// при 0 она исчезла бы; все терраформные тела БД несут 1. 0.15 — пол
// рассеянного света в тени рельефа (0.04 под AgX читался углём).
const DEFAULT_TERRAIN_LAMBERT = 1
const DEFAULT_TERRAIN_AMBIENT = 0.15
// Геометрический N·L полного пола: ниже — пол ∝ солнцу над горизонтом (0 на терминаторе).
const DEFAULT_TERRAIN_AMBIENT_SUN_REF = 0.3

/** Юниформы, общие для сферы и рельефа (объявлены обоими шаблонами). */
export interface PlanetSurfaceUniforms {
  lightPosition: Vector3
  diffuseMap: Texture | null
  nightMap: Texture | null
  cloudMap: Texture | null
  uCloudOpacity: number
  uRegolithMix: number
  uOppositionSurge: number
  // specularMap (сфера), bumpMap, bumpScale, uCavityStrength (рельеф) объявлены
  // общим прологом обоих путей ради паритета, читает их один путь
  specularMap: Texture | null
  bumpMap: Texture | null
  bumpScale: number
  uCavityStrength: number
  emission: number
  uNightThreshold: number
  uNightSoftness: number
  uTerrainLambert: number
  uTerrainAmbient: number
  uTerrainAmbientSunRef: number
  uTerrainOcclusionDirect: number
  uSkyAmbientStrength: number
  uCloudShadowStrength: number
  uCloudHeightUnits: number
  uCloudHeightKm: number
  uCloudLightSoftness: number
  shadowRingsInnerRadius: number
  shadowRingsOuterRadius: number
  shadowRingsTexture: Texture | null
  uAtmoTransmittance: Texture | null
  uAtmoIrradiance: Texture | null
  uAtmoBottomRadius: number
  uAtmoTopRadius: number
  uAtmoSunAngularRadius: number
  uAtmoDatumRadius: number
  uSunTintStrength: number
  uBodyRadiusUnits: number
}

type PlanetSurfaceUniformKey = keyof PlanetSurfaceUniforms

/**
 * Юниформы поверхности планеты, общие для сферы и патчей рельефа: свет,
 * облака, ночь, кольцо, реголит, оттенок солнца. Наследник собирает свой
 * набор как `{ ...this.surfaceUniforms, …свои }`.
 */
abstract class PlanetSurfaceShader<K extends string> extends AbstractShader<K> {
  protected readonly model: Actor
  /** Данные облика: пресет класса под данными тела (terrainClassPresets.ts). */
  protected readonly planetData: IPlanetRenderingObject
  /**
   * Радиус тела (км). 0 остаётся у стаб-акторов тестов без physicalObject,
   * которые шейдер не компилируют, — отсюда клампы делителей у наследников.
   */
  protected readonly radiusKm: number
  protected readonly light: TerrainLightParams
  protected readonly surfaceUniforms: Record<PlanetSurfaceUniformKey, IUniform>

  protected constructor(model: Actor, template: ShaderProps, name: string) {
    super(template)
    this.model = model
    this.planetData = terrainDataOf(this.model)
    const planetData = this.planetData

    const ringData: IRingRenderingObject = (this.model.children
      .where('categoryId', 6)
      .first()
      ?.renderingObject?.getAttribute('data') as IRingRenderingObject | undefined) ?? {
      innerRadius: 0,
      outerRadius: 0,
      alphaTest: 0,
      asteroidDensityScale: 1
    }
    const ringMap: Texture = resourceStorage.getTextureOrMake(
      this.model.children.where('categoryId', 6).first()?.resources.first()?.getAttribute('path') ?? ''
    )

    const USE_RING: boolean = this.model.children.where('categoryId', 6).isNotEmpty()

    this.radiusKm = this.model.physicalObject?.getAttribute('radius') ?? 0
    this.light = resolveTerrainLightParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')
    const light = this.light
    // Закон реголита: доля по атмосфере (ручка данных перекрывает), всплеск — общий резолвер с точкой-импостором
    const regolith = regolithParamsOf(this.model)

    this.surfaceUniforms = {
      lightPosition: new Uniform(new Vector3()),
      diffuseMap: new Uniform(resourceStorage.getTextureOrMake('default.png')),
      nightMap: new Uniform(resourceStorage.getTextureOrMake('night.jpg')),
      cloudMap: new Uniform(null),
      // Высотный fade: 1 — слой виден целиком, кадровое значение ставит материал (updateCloudOpacity)
      uCloudOpacity: new Uniform(1),
      uRegolithMix: new Uniform(regolith.regolithMix),
      uOppositionSurge: new Uniform(regolith.oppositionSurge),
      specularMap: new Uniform(null),
      bumpMap: new Uniform(null),
      bumpScale: new Uniform(planetData.bumpScale ?? 0),
      uCavityStrength: new Uniform(0),
      emission: new Uniform(planetData.emission),
      uNightThreshold: new Uniform(0.06),
      uNightSoftness: new Uniform(0.18),
      uTerrainLambert: new Uniform(planetData.terrainLambert ?? DEFAULT_TERRAIN_LAMBERT),
      uTerrainAmbient: new Uniform(planetData.terrainAmbient ?? DEFAULT_TERRAIN_AMBIENT),
      uTerrainAmbientSunRef: new Uniform(Math.max(planetData.terrainAmbientSunRef ?? DEFAULT_TERRAIN_AMBIENT_SUN_REF, 1e-3)),
      uTerrainOcclusionDirect: new Uniform(light.terrainOcclusionDirect),
      uSkyAmbientStrength: new Uniform(light.skyAmbientStrength),
      uCloudShadowStrength: new Uniform(light.cloudShadowStrength),
      // Высота облачного слоя — тень облаков и параллакс слоя (чанк CloudLayer); км — для LUT атмосферы
      uCloudHeightUnits: new Uniform(toThreeJSUnits(light.cloudHeightKm)),
      uCloudHeightKm: new Uniform(light.cloudHeightKm),
      uCloudLightSoftness: new Uniform(light.cloudLightSoftness),
      shadowRingsInnerRadius: new Uniform(toThreeJSUnits(ringData.innerRadius)),
      shadowRingsOuterRadius: new Uniform(toThreeJSUnits(ringData.outerRadius)),
      shadowRingsTexture: new Uniform(ringMap),
      uAtmoTransmittance: new Uniform(null),
      uAtmoIrradiance: new Uniform(null),
      uAtmoBottomRadius: new Uniform(0),
      uAtmoTopRadius: new Uniform(0),
      uAtmoSunAngularRadius: new Uniform(0),
      uAtmoDatumRadius: new Uniform(0),
      // Дефолт и кламп ручки — ОБЩИЕ с водной оболочкой (clampSunTintStrength):
      // разъехавшись, суша и вода дали бы тональный шов на берегу.
      uSunTintStrength: new Uniform(clampSunTintStrength(planetData.sunTintStrength)),
      uBodyRadiusUnits: new Uniform(toThreeJSUnits(this.radiusKm))
    }
    this.defines = {
      ...(USE_RING && { USE_RING: '1' }),
      ...(regolith.regolithMix > 0 && { USE_REGOLITH: '1' })
    }
    this.name = name
  }
}

export { PlanetSurfaceShader }
