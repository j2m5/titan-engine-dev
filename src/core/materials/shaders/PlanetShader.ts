import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { PlanetShaderTemplate as Shader } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Texture, Uniform, Vector2, Vector3, Vector4 } from 'three'
import { Actor } from '@/core/models/Actor'
import { IPlanetRenderingObject, IRingRenderingObject } from '@/core/models/types'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { clampSunTintStrength } from '@/core/materials/SunTintBinding'

// Нейтральные дефолты детального слоя (используются, только если данные тела
// не задали ручку явно) — см. IPlanetRenderingObject.detail*, ручки Луны в
// storage/database/renderingObjects.ts.
const DEFAULT_DETAIL_SCALE_METERS = 40
const DEFAULT_DETAIL_SCALE2_METERS = 7
const DEFAULT_DETAIL_NORMAL_SCALE = 1
const DEFAULT_DETAIL_SATURATION = 0.15
const DEFAULT_DETAIL_BRIGHTNESS = 1
const DEFAULT_DETAIL_AO_INFLUENCE = 0.5

// Дальность fade (метры дистанции камеры до конца fade шкалы) — тоже ручка
// пер-тела, дефолт нейтрален. 30000 м — дистанция, на которой период крупной
// шкалы (40 м, DEFAULT_DETAIL_SCALE_METERS) опускается ниже ~1 экранного
// пикселя (1080p, fov ~50°); 5000 м для мелкой шкалы (7 м) — та же логика.
const DEFAULT_DETAIL_FADE_METERS = 30000
const DEFAULT_DETAIL_FADE2_METERS = 5000

// Ламберт суши (спайк) — 0 выключен (бит-в-бит прежний шейдер), 0.04 — пол
// рассеянного света в тени рельефа при включённом ламберте.
const DEFAULT_TERRAIN_LAMBERT = 0
const DEFAULT_TERRAIN_AMBIENT = 0.04

// Начало fade относительно конца: не отдельная ручка (см. IPlanetRenderingObject).
const DETAIL_FADE_START_RATIO = 0.4

// Деталь облаков гиганта (чанк GiantDetail) — дефолты ручек тела; сама фича
// живёт под дефайном USE_GIANT_DETAIL, юниформы форвардятся всегда.
// Клетка 400 км ≈ мелкая турбулентность полос Юпитера (R 69 911 км),
// вытяжка 6 — вдоль полосы; конец fade по умолчанию 3·R (с этой дистанции
// экранный след клетки уже гасит все октавы чанка).
const DEFAULT_GIANT_DETAIL_STRENGTH = 0.35
const DEFAULT_GIANT_DETAIL_SCALE_KM = 300
const DEFAULT_GIANT_DETAIL_STRETCH = 6
const DEFAULT_GIANT_DETAIL_WARP = 0.6
const DEFAULT_GIANT_DETAIL_TEXTURE_WARP = 2
const DEFAULT_GIANT_DETAIL_FADE_RADII = 1.5

// Период (метры → юниты) в масштаб трипланарной проекции: чанк TerrainDetail
// умножает домен на 1/период напрямую (см. докстрока чанка) — нулевой период
// невозможен по вводу (метры > 0), гард только от деления на 0 у мусорных данных.
function detailPeriodToScale(periodMeters: number): number {
  const periodUnits = toThreeJSUnits(periodMeters / 1000)

  return periodUnits > 0 ? 1 / periodUnits : 0
}

interface PlanetUniforms {
  lightPosition: Vector3
  diffuseMap: Texture | null
  nightMap: Texture | null
  cloudMap: Texture | null
  uCloudOpacity: number
  specularMap: Texture | null
  bumpMap: Texture | null
  bumpScale: number
  uBumpTexelSize: Vector2
  emission: number
  uSpecularStrength: number
  uNightThreshold: number
  uNightSoftness: number
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
  uCavityStrength: number
  uTerrainLambert: number
  uTerrainAmbient: number
  shadowRingsInnerRadius: number
  shadowRingsOuterRadius: number
  shadowRingsTexture: Texture | null
  uAtmoTransmittance: Texture | null
  uAtmoBottomRadius: number
  uAtmoTopRadius: number
  uAtmoSunAngularRadius: number
  uAtmoDatumRadius: number
  uSunTintStrength: number
  uGiantRadiusKm: number
  uGiantDetailStrength: number
  uGiantDetailScaleKm: number
  uGiantDetailStretch: number
  uGiantDetailWarp: number
  uGiantDetailTextureWarp: number
  uGiantDetailFadeUnits: number
}

class PlanetShader extends AbstractShader<keyof PlanetUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    // `IRenderingObject.data` — `Record<string, unknown>`: схема БД не различает конфиги
    // по категориям, поэтому форма утверждается локально там, где категория известна.
    // detail*-поля опциональны (см. IPlanetRenderingObject) — фолбэк объекту их
    // задавать не нужно, как и ringData ниже не перечисляет свои опциональные ручки.
    const planetData: IPlanetRenderingObject = (this.model.renderingObject?.getAttribute('data') as
      | IPlanetRenderingObject
      | undefined) ?? {
      bumpScale: 0,
      emission: 1
    }

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

    // Радиус тела (км) — домен шума гиганта задан в километрах поверхности,
    // поэтому клетка не зависит от размера тела. Дефайн USE_GIANT_DETAIL
    // ставится только телам БД (у них physicalObject есть); 0 остаётся у
    // стаб-акторов тестов, которые шейдер не компилируют, — при нём домен и
    // fade вырождаются, отсюда кламп fade ниже (деление на 0 в чанке).
    const radiusKm: number = this.model.physicalObject?.getAttribute('radius') ?? 0

    const detailFadeEndUnits = toThreeJSUnits(
      (planetData.detailFadeMeters ?? DEFAULT_DETAIL_FADE_METERS) / 1000
    )
    const detailFade2EndUnits = toThreeJSUnits(
      (planetData.detailFade2Meters ?? DEFAULT_DETAIL_FADE2_METERS) / 1000
    )

    this.uniforms = {
      lightPosition: new Uniform(new Vector3()),
      diffuseMap: new Uniform(resourceStorage.getTextureOrMake('default.png')),
      nightMap: new Uniform(resourceStorage.getTextureOrMake('night.jpg')),
      cloudMap: new Uniform(null),
      // Высотный fade (приёмочная волна 4, №3) — дефолт 1 (виден целиком),
      // per-frame значение считает PlanetMaterial.updateCloudOpacity.
      uCloudOpacity: new Uniform(1),
      specularMap: new Uniform(null),
      bumpMap: new Uniform(null),
      bumpScale: new Uniform(planetData.bumpScale ?? 0),
      uBumpTexelSize: new Uniform(new Vector2()),
      emission: new Uniform(planetData.emission),
      uSpecularStrength: new Uniform(2.0),
      uNightThreshold: new Uniform(0.06),
      uNightSoftness: new Uniform(0.18),
      uDetailDiffMap: new Uniform(null),
      uDetailNorMap: new Uniform(null),
      uDetailArmMap: new Uniform(null),
      uDetailNor2Map: new Uniform(null),
      uDetailScale: new Uniform(detailPeriodToScale(planetData.detailScaleMeters ?? DEFAULT_DETAIL_SCALE_METERS)),
      uDetailScale2: new Uniform(detailPeriodToScale(planetData.detailScale2Meters ?? DEFAULT_DETAIL_SCALE2_METERS)),
      uDetailNormalScale: new Uniform(planetData.detailNormalScale ?? DEFAULT_DETAIL_NORMAL_SCALE),
      uDetailSaturation: new Uniform(planetData.detailSaturation ?? DEFAULT_DETAIL_SATURATION),
      uDetailBrightness: new Uniform(planetData.detailBrightness ?? DEFAULT_DETAIL_BRIGHTNESS),
      uDetailAoInfluence: new Uniform(planetData.detailAoInfluence ?? DEFAULT_DETAIL_AO_INFLUENCE),
      uDetailLayerGates: new Uniform(new Vector3(0, 0, 0)),
      uCavityStrength: new Uniform(0),
      uTerrainLambert: new Uniform(planetData.terrainLambert ?? DEFAULT_TERRAIN_LAMBERT),
      uTerrainAmbient: new Uniform(planetData.terrainAmbient ?? DEFAULT_TERRAIN_AMBIENT),
      uDetailFadeRange: new Uniform(
        new Vector4(
          detailFadeEndUnits * DETAIL_FADE_START_RATIO,
          detailFadeEndUnits,
          detailFade2EndUnits * DETAIL_FADE_START_RATIO,
          detailFade2EndUnits
        )
      ),
      shadowRingsInnerRadius: new Uniform(toThreeJSUnits(ringData.innerRadius)),
      shadowRingsOuterRadius: new Uniform(toThreeJSUnits(ringData.outerRadius)),
      shadowRingsTexture: new Uniform(ringMap),
      uAtmoTransmittance: new Uniform(null),
      uAtmoBottomRadius: new Uniform(0),
      uAtmoTopRadius: new Uniform(0),
      uAtmoSunAngularRadius: new Uniform(0),
      uAtmoDatumRadius: new Uniform(0),
      // Дефолт и кламп ручки — ОБЩИЕ с водной оболочкой (clampSunTintStrength):
      // разъехавшись, суша и вода дали бы тональный шов на берегу.
      uSunTintStrength: new Uniform(clampSunTintStrength(planetData.sunTintStrength)),
      uGiantRadiusKm: new Uniform(radiusKm),
      uGiantDetailStrength: new Uniform(planetData.giantDetailStrength ?? DEFAULT_GIANT_DETAIL_STRENGTH),
      // Кламп положительным минимумом: 0 в знаменателе домена (giantDomain)
      // дал бы деление на ноль/NaN, как у fade ниже.
      uGiantDetailScaleKm: new Uniform(Math.max(planetData.giantDetailScaleKm ?? DEFAULT_GIANT_DETAIL_SCALE_KM, 1e-3)),
      uGiantDetailStretch: new Uniform(Math.max(planetData.giantDetailStretch ?? DEFAULT_GIANT_DETAIL_STRETCH, 1e-3)),
      uGiantDetailWarp: new Uniform(planetData.giantDetailWarp ?? DEFAULT_GIANT_DETAIL_WARP),
      uGiantDetailTextureWarp: new Uniform(planetData.giantDetailTextureWarp ?? DEFAULT_GIANT_DETAIL_TEXTURE_WARP),
      // Кламп положительным минимумом: нулевой fade дал бы деление на ноль в
      // smoothstep чанка (тело без physicalObject или с giantDetailFadeKm: 0).
      uGiantDetailFadeUnits: new Uniform(
        Math.max(toThreeJSUnits(planetData.giantDetailFadeKm ?? DEFAULT_GIANT_DETAIL_FADE_RADII * radiusKm), 1e-6)
      )
    }
    this.defines = {
      ...(USE_RING && { USE_RING: '1' })
    }
    this.name = 'PlanetShader'
  }
}

export { PlanetShader }
