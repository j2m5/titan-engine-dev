import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { PlanetShaderTemplate as Shader } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Texture, Uniform, Vector2, Vector3, Vector4 } from 'three'
import { Actor } from '@/core/models/Actor'
import { IPlanetRenderingObject, IRingRenderingObject } from '@/core/models/types'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'

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

// Начало fade относительно конца: не отдельная ручка (см. IPlanetRenderingObject).
const DETAIL_FADE_START_RATIO = 0.4

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
  shadowRingsInnerRadius: number
  shadowRingsOuterRadius: number
  shadowRingsTexture: Texture | null
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
      specularMap: new Uniform(null),
      bumpMap: new Uniform(null),
      bumpScale: new Uniform(planetData.bumpScale),
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
      shadowRingsTexture: new Uniform(ringMap)
    }
    this.defines = {
      ...(USE_RING && { USE_RING: '1' })
    }
    this.name = 'PlanetShader'
  }
}

export { PlanetShader }
