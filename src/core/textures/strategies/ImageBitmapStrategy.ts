import { CanvasTexture, Texture, type LoadingManager } from 'three'
import { Storage } from '@/core/framework/file/Storage'
import type { TextureLoadStrategy, TextureRequest } from '@/core/textures/types'
import { BitmapTransport, ownBitmaps, type BitmapLoader } from '@/core/textures/BitmapTransport'
import { abortError, checkAborted } from '@/core/textures/cancellation'

const RASTER_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp'])

class ImageBitmapStrategy implements TextureLoadStrategy {
  public constructor(private readonly loader: BitmapLoader) {}

  public static create(manager?: LoadingManager): ImageBitmapStrategy {
    return new ImageBitmapStrategy(new BitmapTransport(manager))
  }

  public supports(request: TextureRequest): boolean {
    return request.paths.length === 1 && RASTER_EXTENSIONS.has(extensionOf(request.paths[0]))
  }

  public async load(request: TextureRequest, signal?: AbortSignal): Promise<Texture<ImageBitmap>> {
    checkAborted(signal)
    // ImageBitmap ignores texture.flipY/premultiplyAlpha at GPU upload time.
    const bitmap = await this.loader.loadAsync(Storage.url(request.paths[0]), signal, {
      imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none'
    })
    if (signal?.aborted) {
      bitmap.close()
      throw abortError()
    }
    const texture = new CanvasTexture(bitmap)
    ownBitmaps(texture, [bitmap])
    return texture
  }
}

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase()
}

export { ImageBitmapStrategy, extensionOf }
