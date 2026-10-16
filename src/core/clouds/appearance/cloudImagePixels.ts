import { createCloudReduction } from './cloudPreparationSteps'
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

/** Bounded native-size reads, with identical canonical row mapping to the sync entry. */
export function* readCloudImagePixelSteps(
  texture: Texture,
  measured?: (stage: 'allocation' | 'native', milliseconds: number) => void
): Generator<void, CloudImagePixels> {
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
  const width = html ? image.naturalWidth : image?.width,
    height = html ? image.naturalHeight : image?.height
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error('Unsupported, closed or unloaded cloud resource image')
  const data = texture instanceof DataTexture
  if (data) {
    if (
      texture.format !== RGBAFormat ||
      texture.type !== UnsignedByteType ||
      !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) ||
      image.data.length !== width * height * 4
    )
      throw new Error('Unsupported cloud DataTexture image; expected unsigned byte RGBA')
  } else if (!bitmap && !(html && image.complete)) throw new Error('Unsupported or unloaded cloud resource image')
  const allocationStart = performance.now()
  const canonical =
    data && !(image.data instanceof Uint8ClampedArray)
      ? new Uint8Array(width * height * 4)
      : new Uint8ClampedArray(width * height * 4)
  measured?.('allocation', performance.now() - allocationStart)
  const flip = bitmap ? false : texture.flipY
  const canvas = data ? null : document.createElement('canvas')
  if (canvas) {
    canvas.width = Math.min(1024, width)
    canvas.height = Math.min(16, height)
  }
  const context = canvas?.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!data && !context) throw new Error('Cloud resource image requires an sRGB Canvas 2D context')
  for (let y = 0; y < height; y += 16)
    for (let x = 0; x < width; x += 1024) {
      const w = Math.min(1024, width - x),
        h = Math.min(16, height - y)
      let bytes: Uint8Array | Uint8ClampedArray
      try {
        if (data) bytes = image.data
        else {
          const nativeStart = performance.now()
          context!.clearRect(0, 0, w, h)
          context!.drawImage(image, x, y, w, h, 0, 0, w, h)
          bytes = context!.getImageData(0, 0, w, h, { colorSpace: 'srgb' }).data
          measured?.('native', performance.now() - nativeStart)
        }
      } catch (cause) {
        throw new Error(
          `Cloud resource image is unreadable: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause }
        )
      }
      for (let row = 0; row < h; row++) {
        const from = data ? ((y + row) * width + x) * 4 : row * w * 4
        const dest = ((flip ? height - 1 - y - row : y + row) * width + x) * 4
        canonical.set(bytes.subarray(from, from + w * 4), dest)
      }
      yield
    }
  return { bytes: canonical, width, height, space, rowOrigin: 'bottom' }
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
  const reduction = createCloudReduction(sw, sh, dw, dh, decode, channels)
  while (!reduction.step(Infinity)) {
    /* synchronous lab caller */
  }
  return reduction.output
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
