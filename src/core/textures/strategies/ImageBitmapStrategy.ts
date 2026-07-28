import { CanvasTexture, ImageBitmapLoader, Texture } from 'three'
import { Storage } from '@/core/framework/file/Storage'
import type { TextureLoadStrategy, TextureRequest } from '@/core/textures/types'

/** Расширения, которые декодирует `createImageBitmap`. */
const RASTER_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp'])

/**
 * Загрузка одиночной растровой текстуры.
 *
 * `ImageBitmapLoader`, а не `TextureLoader`: декодирование уходит с главного
 * потока, поэтому подгрузка на лету не даёт рывка. Переворот запрашивается на
 * этапе декода (`imageOrientation`), потому что для источника `ImageBitmap`
 * рендерер three игнорирует `texture.flipY` — перевернуть уже декодированный
 * битмап он не может.
 */
class ImageBitmapStrategy implements TextureLoadStrategy {
  public constructor(private readonly loader: ImageBitmapLoader) {}

  public static create(): ImageBitmapStrategy {
    const loader = new ImageBitmapLoader()
    loader.setOptions({ imageOrientation: 'flipY' })

    return new ImageBitmapStrategy(loader)
  }

  public supports(request: TextureRequest): boolean {
    if (request.paths.length !== 1) return false

    return RASTER_EXTENSIONS.has(extensionOf(request.paths[0]))
  }

  public async load(request: TextureRequest): Promise<Texture> {
    const bitmap: ImageBitmap = await this.loader.loadAsync(Storage.url(request.paths[0]))

    return new CanvasTexture(bitmap)
  }
}

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase()
}

export { ImageBitmapStrategy, extensionOf }
