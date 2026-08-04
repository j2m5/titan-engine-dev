import { BlendFunction, Effect } from 'postprocessing'
import { Uniform, Vector3 } from 'three'
import { REFERENCE_TEMPERATURE_K, exposureGain, whiteBalanceGain } from './whiteBalance'

/**
 * Экспозиция и баланс белого — свойства съёмки, поэтому применяются в линейном
 * свете, ДО кривой тонмаппинга.
 *
 * В шейдере только умножение: планковский локус и нормировка посчитаны на CPU
 * в `whiteBalance.ts`, где их покрывают числовые тесты.
 */
const fragmentShader = /* glsl */ `
  uniform vec3 gain;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = vec4(inputColor.rgb * gain, inputColor.a);
  }
`

export interface ExposureEffectOptions {
  /** Сдвиг экспозиции в стопах */
  exposure?: number
  /** Температура опорного света в Кельвинах */
  temperature?: number
  /** Зелёный–пурпурный, −1…1 */
  tint?: number
}

export const exposureEffectOptionsDefaults = {
  exposure: 0,
  temperature: REFERENCE_TEMPERATURE_K,
  tint: 0
} satisfies ExposureEffectOptions

export class ExposureEffect extends Effect {
  private readonly gainUniform: Uniform<Vector3>

  private _exposure: number
  private _temperature: number
  private _tint: number

  public constructor(options?: ExposureEffectOptions) {
    const { exposure, temperature, tint } = { ...exposureEffectOptionsDefaults, ...options }

    super('ExposureEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([['gain', new Uniform(new Vector3(1, 1, 1))]])
    })

    this.gainUniform = this.uniforms.get('gain') as Uniform<Vector3>
    this._exposure = exposure
    this._temperature = temperature
    this._tint = tint

    this.updateGain()
  }

  private updateGain(): void {
    this.gainUniform.value
      .copy(whiteBalanceGain(this._temperature, this._tint))
      .multiplyScalar(exposureGain(this._exposure))
  }

  public get exposure(): number {
    return this._exposure
  }

  public set exposure(value: number) {
    this._exposure = value
    this.updateGain()
  }

  public get temperature(): number {
    return this._temperature
  }

  public set temperature(value: number) {
    this._temperature = value
    this.updateGain()
  }

  public get tint(): number {
    return this._tint
  }

  public set tint(value: number) {
    this._tint = value
    this.updateGain()
  }
}
