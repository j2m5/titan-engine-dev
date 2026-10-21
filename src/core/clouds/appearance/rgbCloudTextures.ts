import { reduceCloudPixels } from './cloudImagePixels'
import {
  DataTexture,
  Texture,
  RGBAFormat,
  NoColorSpace,
  RepeatWrapping,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  LinearFilter,
  Color,
  SRGBColorSpace
} from 'three'
import type { CloudColor } from '@/core/clouds/CloudConfig'
import { readCloudImagePixels } from '@/core/clouds/appearance/cloudImagePixels'
import type { CloudAppearanceTextures } from '@/core/clouds/appearance/cloudAppearanceTextures'
import { decodeRgbCloud } from './rgbCloudMap'

export function prepareRgbCloudTextures(
  source: Texture,
  options: { maxWidth?: number; colorStrength?: number; color?: CloudColor } = {}
): CloudAppearanceTextures {
  const maxWidth = options.maxWidth ?? 2048
  const choice = options.color
  const colorStrength = choice ? (choice.kind === 'map' ? choice.strength : 1) : (options.colorStrength ?? 1)
  if (!Number.isInteger(maxWidth) || maxWidth <= 0) throw new RangeError('Invalid cloud maxWidth')
  if (!Number.isFinite(colorStrength) || colorStrength < 0 || colorStrength > 1)
    throw new RangeError('Invalid cloud colorStrength')
  if (choice?.kind === 'constant' && choice.srgb.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
    throw new RangeError('Invalid cloud constant color')
  const linear = choice?.kind === 'constant' ? new Color().setRGB(...choice.srgb, SRGBColorSpace) : new Color(1, 1, 1)
  const constantColorLinear: [number, number, number] = [linear.r, linear.g, linear.b]
  const { bytes, width: sw, height: sh, space } = readCloudImagePixels(source)
  const scale = Math.min(1, Math.min(maxWidth, 2048) / sw, 1024 / sh)
  const dw = Math.max(1, Math.floor(sw * scale)),
    dh = Math.max(1, Math.floor(sh * scale))
  const reduced = reduceCloudPixels(
    sw,
    sh,
    dw,
    dh,
    (at) => {
      const value = decodeRgbCloud([bytes[at] / 255, bytes[at + 1] / 255, bytes[at + 2] / 255], space)
      return [value.coverage, ...value.albedo]
    },
    choice?.kind === 'constant' ? 1 : 4
  )
  const weatherBytes = new Uint8Array(dw * dh * 4)
  const colorBytes = choice?.kind === 'constant' ? null : new Uint8Array(dw * dh * 4)
  for (let at = 0; at < reduced.length; at += 4) {
    weatherBytes[at] = reduced[at]
    if (colorBytes) {
      for (let c = 0; c < 3; c++) colorBytes[at + c] = reduced[at + c + 1]
      colorBytes[at + 3] = 255
    }
  }
  const make = (data: Uint8Array) => {
    const texture = new DataTexture(data, dw, dh, RGBAFormat)
    texture.colorSpace = NoColorSpace
    texture.flipY = false
    texture.wrapS = RepeatWrapping
    texture.wrapT = ClampToEdgeWrapping
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.needsUpdate = true
    return texture
  }
  const weather = make(weatherBytes),
    color = colorBytes ? make(colorBytes) : null
  let disposed = false
  return {
    weather,
    color,
    constantColorLinear,
    colorStrength,
    dispose() {
      if (disposed) return
      disposed = true
      weather.dispose()
      color?.dispose()
    }
  }
}
