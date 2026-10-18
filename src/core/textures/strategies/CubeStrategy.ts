import { CubeTexture, SRGBColorSpace, type LoadingManager } from 'three'
import { Storage } from '@/core/framework/file/Storage'
import type { TextureLoadStrategy, TextureRequest } from '@/core/textures/types'
import { BitmapTransport, ownBitmaps, type BitmapLoader } from '@/core/textures/BitmapTransport'
import { abortError, checkAborted } from '@/core/textures/cancellation'

class CubeStrategy implements TextureLoadStrategy {
  public constructor(private readonly loader: BitmapLoader) {}

  public static create(manager?: LoadingManager): CubeStrategy {
    return new CubeStrategy(new BitmapTransport(manager))
  }

  public supports(request: TextureRequest): boolean {
    return request.paths.length === 6
  }

  public async load(request: TextureRequest, signal?: AbortSignal): Promise<CubeTexture> {
    checkAborted(signal)
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const bitmaps = new Set<ImageBitmap>()
    let failure: unknown
    let failed = false
    try {
      // Settle all faces, including non-abortable decodes, before releasing their sources.
      const faces = await Promise.allSettled(request.paths.map(async (path) => {
        try {
          const bitmap = await this.loader.loadAsync(Storage.url(path), controller.signal, {
            imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none'
          })
          bitmaps.add(bitmap)
          checkAborted(controller.signal)
          return bitmap
        } catch (cause) {
          if (!failed) {
            failed = true
            failure = cause
            controller.abort()
          }
          throw cause
        }
      }))
      checkAborted(signal)
      if (failed) throw failure
      const texture = new CubeTexture(faces.map((face) => {
        if (face.status === 'rejected') throw face.reason
        return face.value
      }))
      texture.colorSpace = SRGBColorSpace
      texture.needsUpdate = true
      ownBitmaps(texture, [...bitmaps])
      return texture
    } catch (cause) {
      for (const bitmap of bitmaps) bitmap.close()
      if (signal?.aborted) throw abortError()
      throw cause
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
}

export { CubeStrategy }
