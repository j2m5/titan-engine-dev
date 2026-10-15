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
import { readCloudImagePixels } from '@/labs/planet-clouds/cloudImagePixels'
import type { CloudAppearanceTextures } from '@/labs/jupiter-clouds/cloudAppearanceTextures'
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
  const { bytes, width: sw, height: sh, space } = readCloudImagePixels(source, null)
  const dw = Math.min(sw, maxWidth),
    dh = Math.max(1, Math.round((sh * dw) / sw))
  const weatherBytes = new Uint8Array(dw * dh * 4),
    colorBytes = choice?.kind === 'constant' ? null : new Uint8Array(dw * dh * 4)
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const x0 = (x * sw) / dw,
        x1 = ((x + 1) * sw) / dw,
        y0 = (y * sh) / dh,
        y1 = ((y + 1) * sh) / dh
      const sums = [0, 0, 0, 0]
      let area = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const weight = overlap(x0, x1, sx, sx + 1) * overlap(y0, y1, sy, sy + 1)
          const row = source.flipY ? sh - 1 - sy : sy,
            at = (row * sw + sx) * 4
          const decoded = decodeRgbCloud([bytes[at] / 255, bytes[at + 1] / 255, bytes[at + 2] / 255], space)
          sums[0] += decoded.coverage * weight
          if (colorBytes) for (let c = 0; c < 3; c++) sums[c + 1] += decoded.albedo[c] * weight
          area += weight
        }
      const at = (y * dw + x) * 4
      weatherBytes[at] = Math.round((255 * sums[0]) / area)
      if (colorBytes) {
        for (let c = 0; c < 3; c++) colorBytes[at + c] = Math.round((255 * sums[c + 1]) / area)
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
