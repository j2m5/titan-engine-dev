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
 * фрагментный шейдер обычного `ShaderMaterial` (`getLuminanceFunction()` в
 * `WebGLProgram`). Поэтому `#include <common>` шейдеру не нужен и его здесь
 * нет: в чанке `common` лежат `PI`, `saturate`, `pow2` и прочее, чего этот
 * шейдер не использует, а `luminance` в нём как раз отсутствует.
 *
 * Смена `HALF_SAMPLES` бесшумно перемасштабирует яркость штриха: сумма весов
 * треугольного кернела растёт вместе с числом отсчётов, а нормировки на неё
 * нет (это соответствует узлу three). При том же входном кадре другой
 * `HALF_SAMPLES` даёт другую яркость на выходе — это не баг, но об этом надо
 * помнить при подборе `streakThreshold`/`streakAmount` заново.
 */
const fragmentShader: string = `
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

    // Гейт квадратичен по яркости (не нормированная сумма весов треугольного
    // кернела равна HALF_SAMPLES — Σ(1 - |i|/N) по i от -N до N даёт N), поэтому
    // total неограничен: уже для серого пикселя с яркостью около
    // sqrt(65504 / HALF_SAMPLES) (~32 при текущем HALF_SAMPLES = 64) произведение
    // уходит за предел HalfFloatType (65504) — Inf, а из него мусор на экране.
    // Формула, а не число: при следующей смене HALF_SAMPLES порог сдвинется сам,
    // без правки комментария. Зажимаем ПОСЛЕ умножения на streakTint, а не total
    // саму по себе: тинт — свободный vec3 без гарантии, что компоненты <= 1,
    // так что предел нужен именно на значении, которое реально ложится в
    // half-float таргет.
    //
    // ЧЕСТНО О ДОСТИЖИМОСТИ: это НЕ заведомо мёртвая страховка от Inf, и
    // достижимость потолка НЕ ИЗМЕРЕНА — у автора кода нет доступа к рантайму,
    // замер за владельцем. Оценка сверху такая: для области источника, которая
    // шире ядра кернела и имеет ровную яркость L, total ≈ L * (L - threshold) *
    // HALF_SAMPLES, то есть потолок 60000 достигается уже около
    // L ≈ sqrt(60000 / HALF_SAMPLES) ≈ 31 (при HALF_SAMPLES = 64) по самому
    // яркому каналу тинта. Значения такого порядка в HDR-буфере звезды вполне
    // реальны.
    //
    // Признак на картинке, если потолок реально упирается на протяжённом
    // участке: треугольное затухание вдоль полосы пропадает, и вместо плавного
    // хвоста видна полоса ПОСТОЯННОЙ яркости с резким обрывом на краю — ровно
    // тот дефект, ради которого поднимали число отсчётов с 33 до 129. Увидев
    // такое, лечить надо не поднятием потолка (за 65504 начинается Inf), а
    // входом: нормировка суммы весов, сжатие яркости источника перед гейтом
    // или более высокий streakThreshold
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
