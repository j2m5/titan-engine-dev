import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture
} from 'three'
import { readCloudImagePixels } from '@/labs/planet-clouds/cloudImagePixels'
import type { CloudLayerConfig } from '@/core/clouds/CloudConfig'
import { coverageFromScalar, decodeCloudScalar } from '@/core/clouds/cloudPatternMath'

export type CloudTextureResolver = (resourceId: number) => Texture | undefined
export type CloudAppearanceTextures = {
  weather: DataTexture
  color: Texture | null
  constantColorLinear: readonly [number, number, number]
  colorStrength: number
  dispose(): void
}

export function prepareCloudAppearanceTextures(
  layer: CloudLayerConfig,
  resolveTexture: CloudTextureResolver
): CloudAppearanceTextures {
  if (layer.pattern.kind !== 'appearance' && layer.pattern.kind !== 'mask') throw new Error('Unsupported cloud pattern')
  const pattern = layer.pattern
  if (pattern.kind === 'mask' && pattern.encoding === 'rgb-cloud-map')
    throw new Error('RGB cloud maps require RGB preparation')
  const resource = (id: number): Texture => {
    const texture = resolveTexture(id)
    if (!texture) throw new Error(`Cloud texture resource ${id} is unavailable`)
    return texture
  }
  let weather: DataTexture | undefined,
    color: Texture | null = null
  try {
    const original = resource(layer.pattern.map.resourceId)
    const { bytes, width, height, space } = readCloudImagePixels(original)
    const output = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const from = ((original.flipY ? height - y - 1 : y) * width + x) * 4
        const scalar = decodeCloudScalar(
          [bytes[from] / 255, bytes[from + 1] / 255, bytes[from + 2] / 255, bytes[from + 3] / 255],
          pattern.decode,
          space
        )
        output[(y * width + x) * 4] = Math.round(255 * coverageFromScalar(scalar, pattern))
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
      readCloudImagePixels(colorSource)
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
