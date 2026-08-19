import { Color, CubeTexture, Texture, Uniform, Vector3 } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { WaterShaderTemplate as Shader } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { createSkyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { Actor } from '@/core/models/Actor'
import { IPlanetRenderingObject } from '@/core/models/types'
import { distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'

// Дефолты ручек воды — честно помеченные заглушки (см. IPlanetRenderingObject),
// приёмка по виду за владельцем (см. память «Flare Visual Checks Are Owner's»).
const DEFAULT_WATER_COLOR = 0x0b3d66
const DEFAULT_WATER_SHALLOW_COLOR = 0x2e8b9e
const DEFAULT_WATER_ALPHA_DEEP = 0.85
// Приёмочная волна 2, №1 (владелец: молочная вода на подлёте) — прежний
// 0xbfe9ff почти белый, и на скользящем взгляде (waveReflectance→1,
// albedo≈0.1+reflection·0.9) читался как сплошное молоко. Затемнён и
// насыщен до устойчивого голубого — дефолт ПОД ПРИЁМКУ, финальный подбор
// цвета/яркости за владельцем (см. память «Flare Visual Checks Are Owner's»).
const DEFAULT_WATER_FRESNEL_TINT = 0x87b8d8
const DEFAULT_WATER_NIGHT_FLOOR = 0.08
// Дисторсия выборки отражения кубмапы (арка water-shader, Task 2) — аналог
// distortionScale Water.js (см. WaterShaderTemplate). Инертна без
// USE_WATER_REFLECTION (гейт по факту доставки кубмапы, см. WaterMaterial).
const DEFAULT_WATER_DISTORTION = 20

// --- Ряд волн (арка water-shader, Task 1). ---

const DEFAULT_WATER_WAVE_SCALE = 1
const DEFAULT_WATER_WAVE_SPEED = 1

/**
 * Мельчайший период ряда getNoise, метры — ОБЯЗАН совпадать с первым
 * делителем в WaterShaderTemplate.ts (`uv / 3000.0`, октава 0). Дублирование
 * неизбежно (GLSL-строка не импортирует TS-константы) — WaterWaves.spec.ts
 * пиннует обе стороны и ловит расхождение.
 *
 * 3000, не 1500 (фикс-раунд 1 ревью Task 1, находка №1): страж кванта
 * (period/N_texels >= 3·R·2^-23) считался на N_texels=512 литералом, а
 * фактический ассет на диске (waternormals.jpg) — 1024×1024. На реальных
 * 1024 текселях 1500 м проваливал страж для Земли (1.46 м < 2.27 м); 3000 м
 * даёт +28.8% запаса для Земли (R=6360 км) и держит страж вплоть до тела
 * радиусом 8192 км (граница ровно на 0) — тест читает N_texels из
 * фактического файла ассета, не литералом, чтобы драйф ассета/страж не
 * могли снова разойтись молча.
 */
export const WATER_WAVE_SMALLEST_PERIOD_METERS = 3000

/** Целевой видимый размер мельчайшей октавы для дефолта fade — см. IPlanetRenderingObject.waterWaveFadeMeters. */
const WATER_WAVE_FADE_TARGET_PIXELS = 1.5
const WATER_WAVE_FADE_FOV_DEGREES = 50
const WATER_WAVE_FADE_VIEWPORT_HEIGHT = 1080

/**
 * Базовый дефолт uWaterWaveFadeMeters при waveScaleHandle=1 — юниты сцены
 * (не метры, несмотря на имя ручки в data, см. её докблок): дистанция, на
 * которой мельчайший период getNoise (WATER_WAVE_SMALLEST_PERIOD_METERS)
 * опускается ниже WATER_WAVE_FADE_TARGET_PIXELS при номинале fov/viewport.
 * Та же формула, что starLodSwitchDistance (apparentSize.ts). При
 * waveScaleHandle≠1 фактический дефолт (см. конструктор WaterShader ниже)
 * делится на handle — увеличение ручки сжимает домен getNoise, эффективный
 * мельчайший период = период/scale, fade обязан подступать пропорционально
 * ближе, иначе мерцание возвращается на дистанциях, где страж кванта уже
 * не проверял этот масштаб (финальное whole-branch ревью, №4).
 */
const DEFAULT_WATER_WAVE_FADE_UNITS = distanceForApparentSize(
  toThreeJSUnits(WATER_WAVE_SMALLEST_PERIOD_METERS / 1000),
  WATER_WAVE_FADE_TARGET_PIXELS,
  WATER_WAVE_FADE_FOV_DEGREES,
  WATER_WAVE_FADE_VIEWPORT_HEIGHT
)

interface WaterUniforms {
  lightPosition: Vector3
  uSlopeMap: Texture | null
  uWaterColor: Color
  uWaterShallowColor: Color
  uWaterAlphaDeep: number
  uWaterFresnelTint: Color
  uWaterNightFloor: number
  uWaterNormalMap: Texture | null
  uTime: number
  uWaterWaveScale: number
  uWaterWaveSpeed: number
  uWaterWaveFadeMeters: number
  // Отражение фоновой кубмапы (арка water-shader, Task 2). uSkyboxMap — сама
  // текстура, доставляется WaterMaterial конструктором (не data-ручка, см.
  // её докблок), здесь только null-заглушка. Набор общей выборки фона —
  // createSkyboxSampleUniforms, ЖЕЛЕЗНЫЙ констрейнт (см. SkyboxSample chunk).
  uSkyboxMap: CubeTexture | null
  uWaterDistortion: number
  uSkyHighlightThreshold: number
  uSkyHighlightBoost: number
  uSkyFloor: number
  uSkyGain: number
  uSkyFlipX: number
}

/**
 * Подмножество IPlanetRenderingObject, которое реально читает WaterShader —
 * все пять полей опциональны в самом интерфейсе, поэтому пустой объект `{}`
 * — честный фолбэк без чужих (планетных) полей. Раньше фолбэк тащил
 * `{ bumpScale: 0, emission: 1 }`, скопированные у PlanetShader, — Water их
 * не читает никогда, поле было мёртвым и вводящим в заблуждение (находка
 * ревью Task 4, фикс-раунд 1, №8).
 */
type WaterRenderingData = Pick<
  IPlanetRenderingObject,
  | 'waterColor'
  | 'waterShallowColor'
  | 'waterAlphaDeep'
  | 'waterFresnelTint'
  | 'waterNightFloor'
  | 'waterWaveScale'
  | 'waterWaveSpeed'
  | 'waterWaveFadeMeters'
  | 'waterDistortion'
>

class WaterShader extends AbstractShader<keyof WaterUniforms> {
  private readonly model: Actor

  public constructor(model: Actor) {
    super(Shader)
    this.model = model

    // Ручки data — то же поле renderingObject.data, что у PlanetShader
    // (schema БД не различает конфиги по категориям, форма утверждается
    // локально); отсутствие data целиком (актор без ручек) — нейтральный
    // фолбэк на дефолты движка, ноль ручек не должен ронять конструктор.
    const waterData: WaterRenderingData = (this.model.renderingObject?.getAttribute('data') as
      | WaterRenderingData
      | undefined) ?? {}

    // Радиус тела, метры — единственный вход uWaterWaveScale (см. её докблок
    // юниформа в WaterShaderTemplate): дословный аналог worldPosition.xz
    // Water.js получается умножением тело-локального dir̂ на этот масштаб
    // ПРЯМО в шейдере (dirLocal лежит в [-1,1], полноразрядно), а не заранее
    // делённым на период — иначе страж кванта (WaterWaves.spec.ts) не имел бы
    // смысла проверять. `?? 0` — стаб-акторы тестов WaterMaterial.spec.ts без
    // physicalObject: волны там всё равно выключены (нет waterNormal-текстуры),
    // масштаб 0 безвреден.
    const radiusMeters = (this.model.physicalObject?.getAttribute('radius') ?? 0) * 1000
    const waveScaleHandle = waterData.waterWaveScale ?? DEFAULT_WATER_WAVE_SCALE
    const waveFadeMetersHandle = waterData.waterWaveFadeMeters

    // Общий набор ручек выборки фона (highlight/floor/gain/flip) — та же
    // фабрика, что SkyboxBackground/BlackHole (ЖЕЛЕЗНЫЙ констрейнт, см.
    // SkyboxSample chunk докблок uSkyFlipX). Раскладывается по отдельным
    // ключам (не spread) — Record<keyof WaterUniforms, IUniform> строгий,
    // а фабрика типизирована шире (Record<string, IUniform>).
    const skySampleUniforms = createSkyboxSampleUniforms()

    this.uniforms = {
      lightPosition: new Uniform(new Vector3()),
      uSlopeMap: new Uniform(null),
      uWaterColor: new Uniform(new Color(waterData.waterColor ?? DEFAULT_WATER_COLOR)),
      uWaterShallowColor: new Uniform(new Color(waterData.waterShallowColor ?? DEFAULT_WATER_SHALLOW_COLOR)),
      uWaterAlphaDeep: new Uniform(waterData.waterAlphaDeep ?? DEFAULT_WATER_ALPHA_DEEP),
      uWaterFresnelTint: new Uniform(new Color(waterData.waterFresnelTint ?? DEFAULT_WATER_FRESNEL_TINT)),
      uWaterNightFloor: new Uniform(waterData.waterNightFloor ?? DEFAULT_WATER_NIGHT_FLOOR),
      // Сэмплер и uTime остаются заглушками до первого updateMaterial()
      // (текстура стримится асинхронно, время — по-кадрово, см. WaterMaterial).
      uWaterNormalMap: new Uniform(null),
      uTime: new Uniform(0),
      uWaterWaveScale: new Uniform(waveScaleHandle * radiusMeters),
      uWaterWaveSpeed: new Uniform(waterData.waterWaveSpeed ?? DEFAULT_WATER_WAVE_SPEED),
      // Дефолт делится на waveScaleHandle (финальное whole-branch ревью, №4):
      // uWaterWaveScale = radiusMeters·waveScaleHandle — увеличение ручки
      // сжимает ДОМЕН getNoise пропорционально (эффективный мельчайший
      // период = WATER_WAVE_SMALLEST_PERIOD_METERS/scale), а страж кванта
      // (WaterWaves.spec.ts) слеп к ручке — считает по TS-константе периода
      // без масштаба. Явную ручку `waterWaveFadeMeters` (метры) НЕ делим —
      // автор данных берёт её как честное число метров на свою
      // ответственность, деление касается только САМОВЫЧИСЛЕННОГО дефолта.
      uWaterWaveFadeMeters: new Uniform(
        waveFadeMetersHandle !== undefined
          ? toThreeJSUnits(waveFadeMetersHandle / 1000)
          : DEFAULT_WATER_WAVE_FADE_UNITS / waveScaleHandle
      ),
      // Кубмапа — заглушка null: доставляется WaterMaterial конструктором
      // (ровно один раз, см. её докблок), не здесь (это CPU-путь "data",
      // текстуры сюда не приходят). Остальной набор — общая выборка фона,
      // тот же `createSkyboxSampleUniforms`, что SkyboxBackground/BlackHole.
      uWaterDistortion: new Uniform(waterData.waterDistortion ?? DEFAULT_WATER_DISTORTION),
      uSkyboxMap: new Uniform(null),
      uSkyHighlightThreshold: skySampleUniforms.uSkyHighlightThreshold,
      uSkyHighlightBoost: skySampleUniforms.uSkyHighlightBoost,
      uSkyFloor: skySampleUniforms.uSkyFloor,
      uSkyGain: skySampleUniforms.uSkyGain,
      uSkyFlipX: skySampleUniforms.uSkyFlipX
    }
    this.name = 'WaterShader'
  }
}

export { WaterShader }
