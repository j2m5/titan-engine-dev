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

export interface StarPalette {
  cool: Colorable
  base: Colorable
  hot: Colorable
}

/**
 * Чёрнотельная палитра звезды: цвета для T−spread / T / T+spread.
 * Палитра в linear-sRGB (шейдер потребляет юниформы как radiance, AgX-пайплайн),
 * температуры защищены от ≤0 (Math.log(negative) в colorTemperatureToRGB даёт NaN).
 * Грануляция интерполирует между ними в шейдере (см. StarShaderTemplate);
 * протуберанцы берут широкий спред 1500K (холодная плазма — краснее).
 */
export function buildStarPalette(temperatureK: number, spreadK: number = 400): StarPalette {
  return {
    cool: srgbColorToLinear(normalizeColor(colorTemperatureToRGB(Math.max(temperatureK - spreadK, 1)))),
    base: srgbColorToLinear(normalizeColor(colorTemperatureToRGB(Math.max(temperatureK, 1)))),
    hot: srgbColorToLinear(normalizeColor(colorTemperatureToRGB(Math.max(temperatureK + spreadK, 1))))
  }
}
