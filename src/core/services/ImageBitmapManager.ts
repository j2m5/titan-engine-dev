import { ResourceManager } from '@/core/services/ResourceManager'
import { IResource } from '@/core/models/types'
import { CanvasTexture, ImageBitmapLoader, Texture } from 'three'
import {
  addTexture,
  deleteTextureByKey,
  getLoadedTextures,
  getTextureByKey,
  getTexturesDirname
} from '@/config/textures'
import { injectable } from 'inversify'

@injectable()
class ImageBitmapManager extends ResourceManager<IResource, ImageBitmap> {
  protected loader: ImageBitmapLoader

  public constructor() {
    super()
    this.loader = new ImageBitmapLoader()
    this.loader.setOptions({ imageOrientation: 'flipY' })
  }

  public async load(source: IResource): Promise<ImageBitmap | undefined> {
    try {
      const regex: RegExp = /(?:.+\/)?([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|gif|bmp|svg|webp))/
      const fullURL: string = this.getFullURL(source.path)
      const match: RegExpMatchArray | null = fullURL.match(regex)
      const imageName: string = match ? match[1] : ''
      const imageBitmap: ImageBitmap = await this.loader.loadAsync(fullURL)
      const texture: Texture = new CanvasTexture(imageBitmap)

      texture.name = imageName
      texture.colorSpace = source.colorSpace ? source.colorSpace : ''
      texture.anisotropy = 8
      texture.needsUpdate = true

      addTexture(source.path, texture)

      return imageBitmap
    } catch (e) {
      console.log(e)
    }
  }

  public remove(key: string): void {
    const texture: Texture | null = getTextureByKey(key)

    if (texture) texture.dispose()

    deleteTextureByKey(key)
  }

  public removeAll(): void {
    const textures: Map<string, Texture> = getLoadedTextures()

    textures.forEach((texture: Texture, key: string): void => {
      if (texture.source.data instanceof ImageBitmap) {
        this.remove(key)
      }
    })
  }

  private getFullURL(url: string): string {
    return `/images/${getTexturesDirname()}/${url}`
  }
}

export { ImageBitmapManager }
