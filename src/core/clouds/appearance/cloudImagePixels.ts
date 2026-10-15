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
  rowOrigin: 'bottom'
}

/** Read at native resolution. GPU upload ignores flipY for an already oriented ImageBitmap. */
export function readCloudImagePixels(texture: Texture): CloudImagePixels {
  const space =
    texture.colorSpace === SRGBColorSpace
      ? 'srgb'
      : texture.colorSpace === NoColorSpace || texture.colorSpace === LinearSRGBColorSpace
        ? 'linear'
        : undefined
  if (!space) throw new Error(`Unsupported cloud texture colorSpace: ${texture.colorSpace}`)
  const image = texture.image
  const bitmap = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap
  const html = typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement
  const width = html ? image.naturalWidth : image?.width
  const height = html ? image.naturalHeight : image?.height
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('Unsupported, closed or unloaded cloud resource image')
  let bytes: Uint8Array | Uint8ClampedArray
  if (texture instanceof DataTexture) {
    if (
      texture.format !== RGBAFormat ||
      texture.type !== UnsignedByteType ||
      !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) ||
      image.data.length !== width * height * 4
    )
      throw new Error('Unsupported cloud DataTexture image; expected unsigned byte RGBA')
    bytes = image.data
  } else {
    if (!bitmap && !(html && image.complete)) throw new Error('Unsupported or unloaded cloud resource image')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
    if (!context) throw new Error('Cloud resource image requires an sRGB Canvas 2D context')
    try {
      context.drawImage(image, 0, 0, width, height)
      bytes = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data
    } catch (cause) {
      throw new Error(`Cloud resource image is unreadable: ${cause instanceof Error ? cause.message : String(cause)}`, {
        cause
      })
    }
  }
  const canonical =
    bytes instanceof Uint8ClampedArray ? new Uint8ClampedArray(width * height * 4) : new Uint8Array(width * height * 4)
  const flipRows = bitmap ? false : texture.flipY
  for (let y = 0; y < height; y++) {
    const row = flipRows ? height - 1 - y : y
    canonical.set(bytes.subarray(row * width * 4, (row + 1) * width * 4), y * width * 4)
  }
  return { bytes: canonical, width, height, space, rowOrigin: 'bottom' }
}

/** Integrate decoded samples over fractional pixel areas, before quantizing any output. */
export function reduceCloudPixels(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  decode: (index: number) => readonly number[],
  channels: number
): Uint8Array {
  const output = new Uint8Array(dw * dh * 4)
  const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c))
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const x0 = (x * sw) / dw,
        x1 = ((x + 1) * sw) / dw,
        y0 = (y * sh) / dh,
        y1 = ((y + 1) * sh) / dh
      const sums = new Array<number>(channels).fill(0)
      let area = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const weight = overlap(x0, x1, sx, sx + 1) * overlap(y0, y1, sy, sy + 1)
          const decoded = decode((sy * sw + sx) * 4)
          for (let c = 0; c < channels; c++) sums[c] += decoded[c] * weight
          area += weight
        }
      for (let c = 0; c < channels; c++) output[(y * dw + x) * 4 + c] = Math.round((255 * sums[c]) / area)
    }
  return output
}

/** A separate Source prevents derivative uploads from advancing the borrowed source version. */
export function createCloudTextureView(source: Texture): Texture {
  const view =
    source instanceof DataTexture
      ? new DataTexture(source.image.data, source.image.width, source.image.height, RGBAFormat, source.type)
      : new Texture(source.image)
  view.colorSpace = source.colorSpace
  view.flipY = source.flipY
  view.premultiplyAlpha = source.premultiplyAlpha
  view.unpackAlignment = source.unpackAlignment
  return view
}
