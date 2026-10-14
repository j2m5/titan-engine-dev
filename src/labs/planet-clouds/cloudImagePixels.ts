import {
  Texture,
  DataTexture,
  SRGBColorSpace,
  NoColorSpace,
  LinearSRGBColorSpace,
  RGBAFormat,
  UnsignedByteType
} from 'three'
import type { CloudInputColorSpace } from '@/core/clouds/cloudPatternMath'

export interface CloudImagePixels {
  bytes: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  space: CloudInputColorSpace
}

export function readCloudImagePixels(texture: Texture, maxWidth: number | null = 1024): CloudImagePixels {
  if (maxWidth !== null && (!Number.isInteger(maxWidth) || maxWidth <= 0))
    throw new RangeError('Invalid cloud maxWidth')
  const space =
    texture.colorSpace === SRGBColorSpace
      ? 'srgb'
      : texture.colorSpace === NoColorSpace || texture.colorSpace === LinearSRGBColorSpace
        ? 'linear'
        : undefined
  if (!space) throw new Error(`Unsupported cloud texture colorSpace: ${texture.colorSpace}`)
  const image = texture.image
  if (texture instanceof DataTexture) {
    if (
      !image ||
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width <= 0 ||
      image.height <= 0 ||
      texture.format !== RGBAFormat ||
      texture.type !== UnsignedByteType ||
      !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) ||
      image.data.length !== image.width * image.height * 4
    )
      throw new Error('Unsupported cloud DataTexture image; expected unsigned byte RGBA')
    // Preserve Jupiter's existing full-resolution DataTexture path.
    return { bytes: image.data, width: image.width, height: image.height, space }
  }
  if (
    typeof HTMLImageElement === 'undefined' ||
    !(image instanceof HTMLImageElement) ||
    !image.complete ||
    !image.naturalWidth ||
    !image.naturalHeight
  )
    throw new Error('Unsupported or unloaded cloud resource image')
  const width = Math.min(maxWidth ?? image.naturalWidth, image.naturalWidth)
  const height = Math.max(1, Math.round((image.naturalHeight * width) / image.naturalWidth))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!context) throw new Error('Cloud resource image requires an sRGB Canvas 2D context')
  context.drawImage(image, 0, 0, width, height)
  return { bytes: context.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data, width, height, space }
}
