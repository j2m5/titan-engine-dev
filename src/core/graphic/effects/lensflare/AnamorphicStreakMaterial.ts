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
 * Анаморфный штрих: горизонтальная растяжка ярких пикселей.
 *
 * Перенос идей из `AnamorphicNode` (three, TSL, стоит за примером
 * `webgpu_postprocessing_anamorphic`). Сам узел не переносится — он на нод-графе
 * под WebGPU.
 *
 * Гейт МНОЖИТЕЛЬНЫЙ и не ограничен сверху: `max(luminance - threshold, 0)`
 * гасит тусклое в ноль, а яркое ядро вытягивает сильнее линейного. Отсюда
 * тонкая черта, а не широкая полоса — в первой попытке тонкости добивались
 * обходным путём, через резкий источник.
 *
 * Материал ждёт ИСХОДНЫЙ кадр в `inputBuffer`: порог 0.9 рассчитан на
 * HDR-яркость кадра, а по уже пороговому буферу порог сработал бы дважды.
 *
 * `luminance()` приходит из пролога, который three вставляет в каждый
 * фрагментный шейдер обычного `ShaderMaterial`.
 */
const fragmentShader: string = `
  #include <common>

  // Число отсчётов — константа шейдера, а не юниформ: цикл с переменной
  // границей GLSL разворачивает хуже, а менять его на лету незачем. Смена
  // требует пересборки шейдера. 32 отсчёта — как в узле three
  #define HALF_SAMPLES 16

  uniform sampler2D inputBuffer;
  uniform vec2 texelSize;
  uniform float streakThreshold;
  uniform float streakScale;
  uniform vec3 streakTint;

  in vec2 vUv;

  void main() {
    vec3 total = vec3(0.0);

    for (int i = -HALF_SAMPLES; i < HALF_SAMPLES; i++) {
      float softness = 1.0 - abs(float(i)) / float(HALF_SAMPLES);
      vec2 uv = clamp(vUv + vec2(texelSize.x * float(i) * streakScale, 0.0), 0.0, 1.0);
      vec3 color = texture(inputBuffer, uv).rgb;

      total += color * max(luminance(color) - streakThreshold, 0.0) * softness;
    }

    gl_FragColor = vec4(total * streakTint, 1.0);
  }
`

export interface AnamorphicStreakMaterialParameters extends ShaderMaterialParameters {
  inputBuffer?: Texture | null
  streakThreshold?: number
  streakScale?: number
  streakTint?: readonly [number, number, number]
}

export const anamorphicStreakMaterialParametersDefaults = {
  streakThreshold: 0.9,
  streakScale: 3,
  streakTint: [0.1, 0.0, 1.0] as const
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
