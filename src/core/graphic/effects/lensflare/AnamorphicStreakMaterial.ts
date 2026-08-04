import {
  NoBlending,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  type ShaderMaterialParameters,
  type Texture
} from 'three'

const vertexShader: string = `
  out vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/**
 * Анаморфный штрих: горизонтальная растяжка ярких пикселей. Идеи перенесены из
 * `AnamorphicNode` (three, TSL) — сам узел под WebGPU и не переносим.
 *
 * Гейт множительный и не ограничен сверху: `max(luminance - threshold, 0)`
 * гасит тусклое в ноль, а яркое ядро вытягивает сильнее линейного.
 *
 * В `inputBuffer` ждёт СОБСТВЕННЫЙ источник — понижение предразмытого буфера
 * (см. `LensFlareEffect`), а не исходный кадр: главную звезду от фоновых
 * отличает размер, а не яркость, и меряет его именно размытие — точка в нём
 * тонет, диск сохраняет яркость. Поэтому `streakThreshold` меряет значения
 * этого буфера и не сопоставим ни с яркостью экрана, ни с порогом блума.
 *
 * `#include <common>` не нужен: `luminance()` вставляет пролог three
 * (`getLuminanceFunction()` в `WebGLProgram`), а в самом чанке его нет.
 */
const fragmentShader: string = `
  // Константа, а не юниформ: цикл с переменной границей GLSL разворачивает хуже.
  // Смена требует пересборки шейдера и перемасштабирует яркость — нормировки на
  // сумму весов нет, а она равна HALF_SAMPLES. Мельчить нельзя: при вылете во
  // весь кадр редкие отсчёты дают копии источника вдоль полосы и рубленый край
  #define HALF_SAMPLES 64

  uniform sampler2D inputBuffer;
  uniform vec2 texelSize;
  uniform float streakThreshold;
  uniform float streakScale;
  uniform vec3 streakTint;

  in vec2 vUv;

  void main() {
    vec3 total = vec3(0.0);

    for (int i = -HALF_SAMPLES; i <= HALF_SAMPLES; i++) {
      float softness = 1.0 - abs(float(i)) / float(HALF_SAMPLES);
      vec2 uv = clamp(vUv + vec2(texelSize.x * float(i) * streakScale, 0.0), 0.0, 1.0);
      vec3 color = texture(inputBuffer, uv).rgb;

      total += color * max(luminance(color) - streakThreshold, 0.0) * softness;
    }

    // Потолок против Inf: гейт квадратичен по яркости, а нормировки нет, так что
    // для ровной области яркости L сумма примерно L * (L - threshold) *
    // HALF_SAMPLES и предел half-float (65504) достигается уже около L ≈ 31.
    // Зажимаем ПОСЛЕ умножения на тинт: тинт — свободный vec3, ограничить надо
    // то, что реально ложится в таргет.
    //
    // Потолок достижим и НЕ измерен. Признак на картинке — затухание вдоль полосы
    // пропадает, остаётся полоса постоянной яркости с резким обрывом. Лечить
    // входом (нормировка, порог), а не поднятием предела: за 65504 начинается Inf
    gl_FragColor = vec4(min(total * streakTint, vec3(60000.0)), 1.0);
  }
`

export interface AnamorphicStreakMaterialParameters extends ShaderMaterialParameters {
  inputBuffer?: Texture | null
  streakThreshold?: number
  streakScale?: number
  streakTint?: readonly [number, number, number]
}

export const anamorphicStreakMaterialParametersDefaults = {
  streakThreshold: 0.3,
  streakScale: 5,
  streakTint: [0.45, 0.6, 1.0] as const
} satisfies AnamorphicStreakMaterialParameters

export class AnamorphicStreakMaterial extends ShaderMaterial {
  constructor(params?: AnamorphicStreakMaterialParameters) {
    const {
      inputBuffer = null,
      streakThreshold,
      streakScale,
      streakTint,
      ...others
    } = {
      ...anamorphicStreakMaterialParametersDefaults,
      ...params
    }
    super({
      name: 'AnamorphicStreakMaterial',
      fragmentShader,
      vertexShader,
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      ...others,
      uniforms: {
        inputBuffer: new Uniform(inputBuffer),
        texelSize: new Uniform(new Vector2()),
        streakThreshold: new Uniform(streakThreshold),
        streakScale: new Uniform(streakScale),
        streakTint: new Uniform(new Vector3(streakTint[0], streakTint[1], streakTint[2])),
        ...others.uniforms
      }
    })
  }

  /**
   * Размеры СЭМПЛИРУЕМОГО буфера, а не таргета, в который проход пишет:
   * `streakScale` меряет шаг в текселях источника
   */
  setSize(width: number, height: number): void {
    this.uniforms.texelSize.value.set(1 / width, 1 / height)
  }

  get inputBuffer(): Texture | null {
    return this.uniforms.inputBuffer.value
  }

  set inputBuffer(value: Texture | null) {
    this.uniforms.inputBuffer.value = value
  }

  get streakThreshold(): number {
    return this.uniforms.streakThreshold.value
  }

  set streakThreshold(value: number) {
    this.uniforms.streakThreshold.value = value
  }

  get streakScale(): number {
    return this.uniforms.streakScale.value
  }

  set streakScale(value: number) {
    this.uniforms.streakScale.value = value
  }

  get streakTint(): Vector3 {
    return this.uniforms.streakTint.value
  }

  set streakTint(value: Vector3) {
    this.uniforms.streakTint.value.copy(value)
  }
}
