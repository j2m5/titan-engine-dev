import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  Texture
} from 'three'
import type { EnabledCloudConfig } from '../CloudConfig'
import { coverageFromScalar, decodeCloudScalar } from '../cloudPatternMath'
import { assertCloudAppearanceSupport } from './cloudAppearance'
import { finalizeCloudColor } from './cloudAppearanceTextures'
import { readCloudImagePixelSteps } from './cloudImagePixels'
import { createCloudReduction } from './cloudPreparationSteps'
import type { prepareCloudSource } from './prepareCloudSource'
import { decodeRgbCloud } from './rgbCloudMap'

export interface CloudPreparationOptions {
  signal?: AbortSignal
  /** Internal deterministic scheduling seam; runtime uses the browser frame scheduler. */
  yield?: () => Promise<void>
  budgetMs?: number
  measured?: (stage: 'slice' | 'allocation' | 'native' | 'read' | 'reduce' | 'finalize', milliseconds: number) => void
}
const aborted = () => new DOMException('Cloud preparation aborted', 'AbortError')
function frameYield(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame = 0,
      timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      reject(aborted())
    }
    if (signal?.aborted) {
      reject(aborted())
      return
    }
    signal?.addEventListener('abort', cancel, { once: true })
    frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', cancel)
        resolve()
      }, 0)
    })
  })
}
/** Captures all borrowed references once. Only job-owned buffers and derivative textures are written. */
export async function prepareCloudSourceAsync(
  config: EnabledCloudConfig,
  resolveTexture: (id: number) => Texture | undefined,
  options: CloudPreparationOptions = {}
): Promise<ReturnType<typeof prepareCloudSource>> {
  assertCloudAppearanceSupport(config)
  const normalized = structuredClone(config),
    layer = normalized.layers[0],
    pattern = layer.pattern
  if (pattern.kind !== 'appearance' && pattern.kind !== 'mask') throw new Error('Unsupported cloud pattern')
  const resource = (id: number) => {
    const value = resolveTexture(id)
    if (!value) throw new Error(`Cloud texture resource ${id} is unavailable`)
    return value
  }
  const source = resource(pattern.map.resourceId)
  const colorSource =
    layer.color.kind === 'map'
      ? layer.color.map.resourceId === pattern.map.resourceId
        ? source
        : resource(layer.color.map.resourceId)
      : undefined
  const captures = [...new Set([source, ...(colorSource ? [colorSource] : [])])].map((texture) => ({
    texture,
    image: texture.image,
    version: texture.version,
    sourceVersion: texture.source.version
  }))
  const check = () => {
    if (options.signal?.aborted) throw aborted()
    if (
      captures.some(
        (c) =>
          c.texture.image !== c.image || c.texture.version !== c.version || c.texture.source.version !== c.sourceVersion
      )
    )
      throw aborted()
  }
  let resumed = 0
  const yieldFrame = async () => {
    check()
    if (resumed) options.measured?.('slice', performance.now() - resumed)
    await (options.yield ? options.yield() : frameYield(options.signal))
    check()
    resumed = performance.now()
  }
  let deadline = 0
  const checkpoint = async () => {
    check()
    if (performance.now() >= deadline) {
      await yieldFrame()
      deadline = performance.now() + (options.budgetMs ?? 4)
    }
  }
  await yieldFrame()
  deadline = performance.now() + (options.budgetMs ?? 4)
  const read = async (texture: Texture) => {
    const steps = readCloudImagePixelSteps(texture, options.measured)
    let next = steps.next()
    while (!next.done) {
      await checkpoint()
      next = steps.next()
    }
    return next.value
  }
  const readStart = performance.now()
  const { bytes, width: sw, height: sh, space } = await read(source)
  if (colorSource && colorSource !== source) await read(colorSource)
  options.measured?.('read', performance.now() - readStart)
  const reduceStart = performance.now()
  const rgb = pattern.kind === 'mask' && pattern.encoding === 'rgb-cloud-map'
  const scale = rgb ? Math.min(1, 2048 / sw, 1024 / sh) : 1
  const width = rgb ? Math.max(1, Math.floor(sw * scale)) : source instanceof DataTexture ? sw : Math.min(sw, 1024)
  const height = rgb ? Math.max(1, Math.floor(sh * scale)) : Math.max(1, Math.round((sh * width) / sw))
  const reduction = createCloudReduction(
    sw,
    sh,
    width,
    height,
    (at) => {
      const sample: [number, number, number, number] = [
        bytes[at] / 255,
        bytes[at + 1] / 255,
        bytes[at + 2] / 255,
        bytes[at + 3] / 255
      ]
      return [
        rgb
          ? decodeRgbCloud([sample[0], sample[1], sample[2]], space).coverage
          : coverageFromScalar(
              decodeCloudScalar(
                sample,
                (pattern as Exclude<typeof pattern, { encoding: 'rgb-cloud-map' }>).decode,
                space
              ),
              pattern as Exclude<typeof pattern, { encoding: 'rgb-cloud-map' }>
            )
      ]
    },
    1
  )
  while (!reduction.step(256)) await checkpoint()
  options.measured?.('reduce', performance.now() - reduceStart)
  await checkpoint()
  check()
  const finalizeStart = performance.now()
  const weather = new DataTexture(reduction.output, width, height, RGBAFormat)
  weather.colorSpace = NoColorSpace
  weather.flipY = false
  weather.wrapS = RepeatWrapping
  weather.wrapT = ClampToEdgeWrapping
  weather.generateMipmaps = true
  weather.minFilter = LinearMipmapLinearFilter
  weather.magFilter = LinearFilter
  weather.needsUpdate = true
  try {
    const appearance = finalizeCloudColor(layer.color, colorSource)
    if (rgb)
      layer.pattern = {
        kind: 'mask',
        encoding: 'scalar',
        map: pattern.map,
        decode: { channel: 'r', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'linear' }
      }
    let disposed = false
    const textures = {
      weather,
      ...appearance,
      dispose() {
        if (disposed) return
        disposed = true
        weather.dispose()
        appearance.color?.dispose()
      }
    }
    options.measured?.('finalize', performance.now() - finalizeStart)
    options.measured?.('slice', performance.now() - resumed)
    return { config: normalized, textures, dispose: () => textures.dispose() }
  } catch (error) {
    weather.dispose()
    throw error
  }
}
