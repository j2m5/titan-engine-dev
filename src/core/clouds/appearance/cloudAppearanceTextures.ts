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
import {
  readCloudImagePixels,
  reduceCloudPixels,
  createCloudTextureView
} from '@/core/clouds/appearance/cloudImagePixels'
import type { CloudColor, CloudLayerConfig } from '@/core/clouds/CloudConfig'
import { coverageFromScalar, decodeCloudScalar } from '@/core/clouds/cloudPatternMath'

export type CloudTextureResolver = (resourceId: number) => Texture | undefined
export type CloudAppearanceTextures = {
  weather: DataTexture
  color: Texture | null
  constantColorLinear: readonly [number, number, number]
  colorStrength: number
  dispose(): void
}

export function prepareCloudColor(
  choice: CloudColor,
  resolveTexture: CloudTextureResolver
): Pick<CloudAppearanceTextures, 'color' | 'constantColorLinear' | 'colorStrength'> {
  const constant = new Color()
  let color: Texture | null = null
  if (choice.kind === 'map') {
    const source = resolveTexture(choice.map.resourceId)
    if (!source) throw new Error(`Cloud texture resource ${choice.map.resourceId} is unavailable`)
    readCloudImagePixels(source)
    color = createCloudTextureView(source)
    color.wrapS = RepeatWrapping
    color.wrapT = ClampToEdgeWrapping
    color.minFilter = LinearMipmapLinearFilter
    color.magFilter = LinearFilter
    color.generateMipmaps = true
    color.needsUpdate = true
  } else constant.setRGB(...choice.srgb, SRGBColorSpace)
  return {
    color,
    constantColorLinear: [constant.r, constant.g, constant.b],
    colorStrength: choice.kind === 'map' ? choice.strength : 1
  }
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
    const { bytes, width: sw, height: sh, space } = readCloudImagePixels(original)
    const width = original instanceof DataTexture ? sw : Math.min(sw, 1024)
    const height = Math.max(1, Math.round((sh * width) / sw))
    const output = reduceCloudPixels(
      sw,
      sh,
      width,
      height,
      (from) => {
        const scalar = decodeCloudScalar(
          [bytes[from] / 255, bytes[from + 1] / 255, bytes[from + 2] / 255, bytes[from + 3] / 255],
          pattern.decode,
          space
        )
        return [coverageFromScalar(scalar, pattern)]
      },
      1
    )
    weather = new DataTexture(output, width, height, RGBAFormat)
    weather.colorSpace = NoColorSpace
    weather.wrapS = RepeatWrapping
    weather.wrapT = ClampToEdgeWrapping
    weather.minFilter = LinearMipmapLinearFilter
    weather.magFilter = LinearFilter
    weather.generateMipmaps = true
    weather.flipY = false
    weather.needsUpdate = true
    const appearance = prepareCloudColor(layer.color, resolveTexture)
    color = appearance.color
    let disposed = false
    const ownedWeather = weather
    return {
      weather,
      ...appearance,
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
