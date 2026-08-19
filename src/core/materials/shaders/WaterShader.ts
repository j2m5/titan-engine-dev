import { Color, Texture, Uniform, Vector3 } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { WaterShaderTemplate as Shader } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { IPlanetRenderingObject } from '@/core/models/types'

// Дефолты ручек воды — честно помеченные заглушки (см. IPlanetRenderingObject),
// приёмка по виду за владельцем (см. память «Flare Visual Checks Are Owner's»).
const DEFAULT_WATER_COLOR = 0x0b3d66
const DEFAULT_WATER_SHALLOW_COLOR = 0x2e8b9e
const DEFAULT_WATER_ALPHA_DEEP = 0.85
const DEFAULT_WATER_FRESNEL_TINT = 0xbfe9ff
const DEFAULT_WATER_NIGHT_FLOOR = 0.08

interface WaterUniforms {
  lightPosition: Vector3
  uSlopeMap: Texture | null
  uWaterColor: Color
  uWaterShallowColor: Color
  uWaterAlphaDeep: number
  uWaterFresnelTint: Color
  uWaterNightFloor: number
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
  'waterColor' | 'waterShallowColor' | 'waterAlphaDeep' | 'waterFresnelTint' | 'waterNightFloor'
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

    this.uniforms = {
      lightPosition: new Uniform(new Vector3()),
      uSlopeMap: new Uniform(null),
      uWaterColor: new Uniform(new Color(waterData.waterColor ?? DEFAULT_WATER_COLOR)),
      uWaterShallowColor: new Uniform(new Color(waterData.waterShallowColor ?? DEFAULT_WATER_SHALLOW_COLOR)),
      uWaterAlphaDeep: new Uniform(waterData.waterAlphaDeep ?? DEFAULT_WATER_ALPHA_DEEP),
      uWaterFresnelTint: new Uniform(new Color(waterData.waterFresnelTint ?? DEFAULT_WATER_FRESNEL_TINT)),
      uWaterNightFloor: new Uniform(waterData.waterNightFloor ?? DEFAULT_WATER_NIGHT_FLOOR)
    }
    this.name = 'WaterShader'
  }
}

export { WaterShader }
