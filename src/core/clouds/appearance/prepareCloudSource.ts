import type { Texture } from 'three'
import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'
import { assertCloudAppearanceSupport } from './cloudAppearance'
import {
  prepareCloudAppearanceTextures,
  prepareCloudColor,
  type CloudAppearanceTextures
} from './cloudAppearanceTextures'
import { prepareRgbCloudTextures } from './rgbCloudTextures'

/** Normalize only RGB source semantics; all caller-owned descriptors and images stay untouched. */
export function prepareCloudSource(
  config: EnabledCloudConfig,
  resolveTexture: (resourceId: number) => Texture | undefined
): { config: EnabledCloudConfig; textures: CloudAppearanceTextures; dispose(): void } {
  assertCloudAppearanceSupport(config)
  const normalized = structuredClone(config)
  const layer = normalized.layers[0]
  let textures: CloudAppearanceTextures
  if (layer.pattern.kind === 'mask' && layer.pattern.encoding === 'rgb-cloud-map') {
    const source = resolveTexture(layer.pattern.map.resourceId)
    if (!source) throw new Error(`Cloud texture resource ${layer.pattern.map.resourceId} is unavailable`)
    const density = prepareRgbCloudTextures(source, { color: { kind: 'constant', srgb: [1, 1, 1] } })
    try {
      const appearance = prepareCloudColor(layer.color, resolveTexture)
      let disposed = false
      textures = {
        ...density,
        ...appearance,
        dispose() {
          if (disposed) return
          disposed = true
          density.dispose()
          appearance.color?.dispose()
        }
      }
    } catch (error) {
      density.dispose()
      throw error
    }
    layer.pattern = {
      kind: 'mask',
      encoding: 'scalar',
      map: layer.pattern.map,
      decode: { channel: 'r', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'linear' }
    }
  } else textures = prepareCloudAppearanceTextures(layer, resolveTexture)
  return { config: normalized, textures, dispose: () => textures.dispose() }
}
