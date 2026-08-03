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
 * Материал ждёт СОБСТВЕННЫЙ ИСТОЧНИК в `inputBuffer` — понижение предразмытого
 * буфера до четверти разрешения (см. `LensFlareEffect`), а не исходный кадр.
 * Причина в том, что абсолютная яркость не разделяет главную звезду и фоновые:
 * они лежат в одном диапазоне HDR, и порог, убирающий чёрточки на фоне,
 * убирает штрих и на самой звезде. Разделяет их размер, а размер меряет
 * размытие: точка в нём расплывается и тонет, диск сохраняет яркость.
 *
 * Отсюда же следует, что `streakThreshold` НЕ сопоставим ни с яркостью экрана,
 * ни с порогом блума: он меряет значения этого буфера.
 *
 * `luminance()` приходит из пролога, который three вставляет в каждый
 * фрагментный шейдер обычного `ShaderMaterial`.
 *
 * Смена `HALF_SAMPLES` бесшумно перемасштабирует яркость штриха: сумма весов
 * треугольного кернела растёт вместе с числом отсчётов, а нормировки на неё
 * нет (это соответствует узлу three). При том же входном кадре другой
 * `HALF_SAMPLES` даёт другую яркость на выходе — это не баг, но об этом надо
 * помнить при подборе `streakThreshold`/`streakAmount` заново.
 */
const fragmentShader: string = `
  #include <common>

  // Число отсчётов — константа шейдера, а не юниформ: цикл с переменной
  // границей GLSL разворачивает хуже, а менять его на лету незачем. Смена
  // требует пересборки шейдера. Границы включают оба края (i <= HALF_SAMPLES):
  // 129 отсчётов, крайние два — с нулевым весом, цена за симметричный
  // треугольник.
  //
  // 129, а не прежние 33: при вылете во весь кадр редкие отсчёты дают видимые
  // копии диска источника вдоль полосы и рубленый край вместо затухания.
  // У узла three кернел асимметричен (i < HALF_SAMPLES) — здесь это выправлено
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

    // Гейт квадратичен по яркости (не нормированная сумма весов кернела — 16),
    // поэтому total неограничен: уже для серого пикселя с яркостью около 64
    // произведение уходит за предел HalfFloatType (65504) — Inf, а из него
    // мусор на экране. Зажимаем ПОСЛЕ умножения на streakTint, а не total
    // саму по себе: тинт — свободный vec3 без гарантии, что компоненты <= 1,
    // так что предел нужен именно на значении, которое реально ложится в
    // half-float таргет
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
