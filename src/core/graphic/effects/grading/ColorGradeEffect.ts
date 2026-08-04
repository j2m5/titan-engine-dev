import { BlendFunction, Effect } from 'postprocessing'
import { Uniform, Vector3 } from 'three'

/**
 * Грейдинг после кривой тонмаппинга: работа поверх уже сжатых значений, как у
 * колориста. Экспозиция и баланс белого сюда не входят — они свойства съёмки и
 * применяются до кривой (см. `ExposureEffect`).
 *
 * Собственная `gradeLuminance` вместо функции из пролога: веса должны быть
 * видны здесь же, их правка не должна зависеть от версии three.
 */
const fragmentShader = /* glsl */ `
  uniform float contrast;
  uniform float saturation;
  uniform vec3 shadowTint;
  uniform float shadowLift;
  uniform vec3 highlightTint;
  uniform float highlightGain;

  float gradeLuminance(const in vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 color = inputColor.rgb;

    color = (color - 0.5) * contrast + 0.5;
    color = mix(vec3(gradeLuminance(color)), color, saturation);

    // Подъём теней аддитивный: умножением тень к оттенку не увести — ноль
    // остаётся нулём независимо от множителя
    float shadowWeight = 1.0 - smoothstep(0.0, 0.5, gradeLuminance(color));
    color += shadowTint * (shadowLift * shadowWeight);

    // Тонировка светов множительная: света уже яркие, добавлять им нечего
    float highlightWeight = smoothstep(0.4, 1.0, gradeLuminance(color));
    color = mix(color, color * highlightTint, highlightGain * highlightWeight);

    outputColor = vec4(max(color, vec3(0.0)), inputColor.a);
  }
`

export interface ColorGradeEffectOptions {
  contrast?: number
  saturation?: number
  shadowTint?: readonly [number, number, number]
  shadowLift?: number
  highlightTint?: readonly [number, number, number]
  highlightGain?: number
}

export const colorGradeEffectOptionsDefaults = {
  contrast: 1,
  saturation: 1,
  shadowTint: [0, 0, 0] as const,
  shadowLift: 0,
  highlightTint: [1, 1, 1] as const,
  highlightGain: 0
} satisfies ColorGradeEffectOptions

export class ColorGradeEffect extends Effect {
  public constructor(options?: ColorGradeEffectOptions) {
    const { contrast, saturation, shadowTint, shadowLift, highlightTint, highlightGain } = {
      ...colorGradeEffectOptionsDefaults,
      ...options
    }

    super('ColorGradeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['contrast', new Uniform(contrast)],
        ['saturation', new Uniform(saturation)],
        ['shadowTint', new Uniform(new Vector3(shadowTint[0], shadowTint[1], shadowTint[2]))],
        ['shadowLift', new Uniform(shadowLift)],
        ['highlightTint', new Uniform(new Vector3(highlightTint[0], highlightTint[1], highlightTint[2]))],
        ['highlightGain', new Uniform(highlightGain)]
      ])
    })
  }

  public get contrast(): number {
    return this.uniforms.get('contrast')!.value
  }

  public set contrast(value: number) {
    this.uniforms.get('contrast')!.value = value
  }

  public get saturation(): number {
    return this.uniforms.get('saturation')!.value
  }

  public set saturation(value: number) {
    this.uniforms.get('saturation')!.value = value
  }

  public get shadowTint(): Vector3 {
    return this.uniforms.get('shadowTint')!.value
  }

  public get shadowLift(): number {
    return this.uniforms.get('shadowLift')!.value
  }

  public set shadowLift(value: number) {
    this.uniforms.get('shadowLift')!.value = value
  }

  public get highlightTint(): Vector3 {
    return this.uniforms.get('highlightTint')!.value
  }

  public get highlightGain(): number {
    return this.uniforms.get('highlightGain')!.value
  }

  public set highlightGain(value: number) {
    this.uniforms.get('highlightGain')!.value = value
  }
}
