import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType
} from 'three'
import type { CloudLayerConfig } from '@/core/clouds/CloudConfig'
import { coverageFromScalar, decodeCloudScalar, type CloudInputColorSpace } from '@/core/clouds/cloudPatternMath'

export type CloudTextureResolver = (resourceId: number) => Texture | undefined
export type CloudAppearanceTextures = {
  weather: DataTexture
  color: Texture | null
  constantColorLinear: readonly [number, number, number]
  colorStrength: number
  dispose(): void
}

function readPixels(texture: Texture): {
  bytes: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  space: CloudInputColorSpace
} {
  const space =
    texture.colorSpace === SRGBColorSpace
      ? 'srgb'
      : texture.colorSpace === NoColorSpace || texture.colorSpace === LinearSRGBColorSpace
        ? 'linear'
        : undefined
  if (!space) throw new Error(`Unsupported cloud texture colorSpace: ${texture.colorSpace}`)
  const image = texture.image
  if (!image || !image.width || !image.height) throw new Error('Cloud resource image is not loaded')
  if (texture instanceof DataTexture) {
    if (
      texture.format !== RGBAFormat ||
      texture.type !== UnsignedByteType ||
      !(image.data instanceof Uint8Array) ||
      image.data.length !== image.width * image.height * 4
    )
      throw new Error('Unsupported cloud DataTexture image; expected unsigned byte RGBA')
    return { bytes: image.data, width: image.width, height: image.height, space }
  }
  if (
    typeof HTMLImageElement === 'undefined' ||
    !(image instanceof HTMLImageElement) ||
    !image.complete ||
    !image.naturalWidth
  )
    throw new Error('Unsupported or unloaded cloud resource image')
  const width = Math.min(1024, image.naturalWidth),
    height = Math.max(1, Math.round((image.naturalHeight * width) / image.naturalWidth))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
  if (!context) throw new Error('Cloud resource image requires an sRGB Canvas 2D context')
  context.drawImage(image, 0, 0, width, height)
  return { bytes: context.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data, width, height, space }
}

export function prepareCloudAppearanceTextures(
  layer: CloudLayerConfig,
  resolveTexture: CloudTextureResolver
): CloudAppearanceTextures {
  if (layer.pattern.kind !== 'appearance') throw new Error('Unsupported cloud pattern')
  const resource = (id: number): Texture => {
    const texture = resolveTexture(id)
    if (!texture) throw new Error(`Cloud texture resource ${id} is unavailable`)
    return texture
  }
  let weather: DataTexture | undefined,
    color: Texture | null = null
  try {
    const original = resource(layer.pattern.map.resourceId)
    const { bytes, width, height, space } = readPixels(original)
    const output = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const from = ((original.flipY ? height - y - 1 : y) * width + x) * 4
        const scalar = decodeCloudScalar(
          [bytes[from] / 255, bytes[from + 1] / 255, bytes[from + 2] / 255, bytes[from + 3] / 255],
          layer.pattern.decode,
          space
        )
        output[(y * width + x) * 4] = Math.round(255 * coverageFromScalar(scalar, layer.pattern))
      }
    weather = new DataTexture(output, width, height, RGBAFormat)
    weather.colorSpace = NoColorSpace
    weather.wrapS = RepeatWrapping
    weather.wrapT = ClampToEdgeWrapping
    weather.minFilter = LinearMipmapLinearFilter
    weather.magFilter = LinearFilter
    weather.generateMipmaps = true
    weather.flipY = false
    weather.needsUpdate = true
    const constant = new Color()
    if (layer.color.kind === 'map') {
      const colorSource = resource(layer.color.map.resourceId)
      readPixels(colorSource)
      color = colorSource.clone()
      color.wrapS = RepeatWrapping
      color.wrapT = ClampToEdgeWrapping
      color.minFilter = LinearMipmapLinearFilter
      color.magFilter = LinearFilter
      color.generateMipmaps = true
      color.needsUpdate = true
    } else constant.setRGB(...layer.color.srgb, SRGBColorSpace)
    let disposed = false
    const ownedWeather = weather
    return {
      weather,
      color,
      constantColorLinear: [constant.r, constant.g, constant.b],
      colorStrength: layer.color.kind === 'map' ? layer.color.strength : 1,
      dispose() {
        if (disposed) return
        disposed = true
        ownedWeather.dispose()
        color?.dispose()
      }
    }
  } catch (error) {
    weather?.dispose()
    color?.dispose()
    throw error
  }
}
