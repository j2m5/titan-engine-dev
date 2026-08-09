import { clamp } from 'three/src/math/MathUtils'
import { Colorable } from '@/core/models/types'

export function normalizeColor(color: Colorable): Colorable {
  return {
    r: color.r / 255,
    g: color.g / 255,
    b: color.b / 255
  }
}

export function colorTemperatureToRGB(kelvin: number): Colorable {
  const temp: number = kelvin / 100

  let red, green, blue

  if (temp <= 66) {
    red = 255

    green = temp
    green = 99.4708025861 * Math.log(green) - 161.1195681661

    if (temp <= 19) {
      blue = 0
    } else {
      blue = temp - 10
      blue = 138.5177312231 * Math.log(blue) - 305.0447927307
    }
  } else {
    red = temp - 60
    red = 329.698727446 * Math.pow(red, -0.1332047592)

    green = temp - 60
    green = 288.1221695283 * Math.pow(green, -0.0755148492)

    blue = 255
  }

  return {
    r: clamp(red, 0, 255),
    g: clamp(green, 0, 255),
    b: clamp(blue, 0, 255)
  }
}

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** sRGB-кодированный Colorable (0..1) -> linear-sRGB (рабочее пространство рендера) */
export function srgbColorToLinear(color: Colorable): Colorable {
  return {
    r: srgbChannelToLinear(color.r),
    g: srgbChannelToLinear(color.g),
    b: srgbChannelToLinear(color.b)
  }
}

/**
 * Поканальная линейная интерполяция. Форма a*(1-t) + b*t, а не a + (b-a)*t:
 * первая точна на обоих концах, вторая при t = 1 даёт 0.09999999999999998
 * вместо 0.1. Семантика совпадает с mix в GLSL.
 */
export function mixColor(a: Colorable, b: Colorable, t: number): Colorable {
  return {
    r: a.r * (1 - t) + b.r * t,
    g: a.g * (1 - t) + b.g * t,
    b: a.b * (1 - t) + b.b * t
  }
}

export function rgbToHex(color: Colorable): string {
  const { r, g, b } = color
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}

export function hexToRGB(hex: string): Colorable {
  if (hex[0] === '#') {
    hex = hex.slice(1)
  }
  if (hex.length <= 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  const result = parseInt(hex, 16)

  return {
    r: (result >> 16) & 255,
    g: (result >> 8) & 255,
    b: result & 255
  }
}

/**
 * Дефолт температуры звезды без атрибута в данных. Общий для диска
 * (StarShader) и билборда (FakeStar): разные дефолты давали цветовой шов
 * на стыке LOD — красный диск (3000K) против солнечного билборда (5700K).
 * StarInnerLayer/StarOuterLayer пока со своими дефолтами — бэклог.
 */
export const DEFAULT_STAR_TEMPERATURE_K: number = 5700

/**
 * Константы поверхности звезды, общие для диска (StarShader/StarShaderTemplate)
 * и билборда-импостора (FakeStar). Пер-LOD копии этих чисел — это
 * рассинхронизация яркости, лимба и скорости эволюции грануляции, то есть
 * видимый шов на переключении LOD.
 */
export const STAR_CORE_INTENSITY: number = 4.0
export const STAR_LIMB_COEFF: readonly [number, number, number] = [0.5, 0.65, 0.8]
export const STAR_GRANULATION_TIME_SCALE: number = 0.01

/**
 * Нижняя граница области определения аппроксимации в colorTemperatureToRGB.
 * Ниже неё формула возвращает не физику, а продолжение подгонки за пределы
 * её диапазона.
 */
export const COLOR_TEMPERATURE_FLOOR_K: number = 1000

export interface StarPalette {
  cool: Colorable
  base: Colorable
  hot: Colorable
}

/**
 * Чёрнотельная палитра звезды: цвета для T−spread / T / T+spread.
 * Палитра в linear-sRGB (шейдер потребляет юниформы как radiance, AgX-пайплайн).
 * Грануляция интерполирует между ними в шейдере (см. StarShaderTemplate);
 * протуберанцы берут широкий спред 1500K (холодная плазма — краснее).
 *
 * Температуры зажаты снизу полом области определения аппроксимации, а не
 * единицей: ниже 1000 K формула отдаёт продолжение подгонки за её диапазон.
 * Ловушка: у звезды холоднее ~2500 K спред 1500 упрётся в пол, и внешний слой
 * сменит цвет молча. Нынешние звёзды все горячее.
 */
export function buildStarPalette(temperatureK: number, spreadK: number = 400): StarPalette {
  return {
    cool: srgbColorToLinear(normalizeColor(colorTemperatureToRGB(Math.max(temperatureK - spreadK, COLOR_TEMPERATURE_FLOOR_K)))),
    base: srgbColorToLinear(normalizeColor(colorTemperatureToRGB(Math.max(temperatureK, COLOR_TEMPERATURE_FLOOR_K)))),
    hot: srgbColorToLinear(normalizeColor(colorTemperatureToRGB(Math.max(temperatureK + spreadK, COLOR_TEMPERATURE_FLOOR_K))))
  }
}
