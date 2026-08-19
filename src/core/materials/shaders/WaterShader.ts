import { Color, Texture, Uniform, Vector3 } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { WaterShaderTemplate as Shader } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { IPlanetRenderingObject } from '@/core/models/types'
import { distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'

// Дефолты ручек воды — честно помеченные заглушки (см. IPlanetRenderingObject),
// приёмка по виду за владельцем (см. память «Flare Visual Checks Are Owner's»).
const DEFAULT_WATER_COLOR = 0x0b3d66
const DEFAULT_WATER_SHALLOW_COLOR = 0x2e8b9e
const DEFAULT_WATER_ALPHA_DEEP = 0.85
const DEFAULT_WATER_FRESNEL_TINT = 0xbfe9ff
const DEFAULT_WATER_NIGHT_FLOOR = 0.08

// --- Ряд волн (арка water-shader, Task 1). ---

const DEFAULT_WATER_WAVE_SCALE = 1
const DEFAULT_WATER_WAVE_SPEED = 1

/**
 * Мельчайший период ряда getNoise, метры — ОБЯЗАН совпадать с первым
 * делителем в WaterShaderTemplate.ts (`uv / 1500.0`, октава 0). Дублирование
 * неизбежно (GLSL-строка не импортирует TS-константы) — WaterWaves.spec.ts
 * пиннует обе стороны и ловит расхождение.
 */
export const WATER_WAVE_SMALLEST_PERIOD_METERS = 1500

/** Целевой видимый размер мельчайшей октавы для дефолта fade — см. IPlanetRenderingObject.waterWaveFadeMeters. */
const WATER_WAVE_FADE_TARGET_PIXELS = 1.5
const WATER_WAVE_FADE_FOV_DEGREES = 50
const WATER_WAVE_FADE_VIEWPORT_HEIGHT = 1080

/**
 * Дефолт uWaterWaveFadeMeters — юниты сцены (не метры, несмотря на имя
 * ручки в data, см. её докблок): дистанция, на которой мельчайший период
 * getNoise (WATER_WAVE_SMALLEST_PERIOD_METERS) опускается ниже
 * WATER_WAVE_FADE_TARGET_PIXELS при номинале fov/viewport. Та же формула,
 * что starLodSwitchDistance (apparentSize.ts) — CPU переводит метры в юниты
 * ОДИН раз, здесь и при явной ручке (см. WaterShader ниже), шейдер сравнивает
 * готовые юниты с length(vViewPosition) без собственной конвертации.
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
      uWaterWaveFadeMeters: new Uniform(
        waveFadeMetersHandle !== undefined
          ? toThreeJSUnits(waveFadeMetersHandle / 1000)
          : DEFAULT_WATER_WAVE_FADE_UNITS
      )
    }
    this.name = 'WaterShader'
  }
}

export { WaterShader }
