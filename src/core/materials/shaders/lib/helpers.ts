import { clamp } from 'three/src/math/MathUtils'
import { Colorable } from '@/core/models/types.ts'

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
