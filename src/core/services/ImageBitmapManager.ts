import dayjs from 'dayjs'
import { ResourceManager, ResourceItem } from '@/core/services/ResourceManager'
import { IActorBoundResource } from '@/core/models/types'
import { CanvasTexture, ImageBitmapLoader, Texture } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'

class ImageBitmapManager extends ResourceManager<IActorBoundResource, ImageBitmap> {
  protected loader: ImageBitmapLoader

  public constructor() {
    super()
    this.loader = new ImageBitmapLoader()
    this.loader.setOptions({ imageOrientation: 'flipY' })
  }

  public async load(source: IActorBoundResource): Promise<ImageBitmap | undefined> {
    try {
      const fullURL: string = this.getFullURL(source.path)
      const imageBitmap: ImageBitmap = await this.loader.loadAsync(fullURL)
      const texture: Texture = new CanvasTexture(imageBitmap)

      const resource: ResourceItem = {
        actorId: source.actorId ?? null,
        type: 'bitmap',
        loadedAt: dayjs(),
        expiredAt: dayjs().add(source.lifetime, 'millisecond')
      }

      texture.name = source.path
      texture.colorSpace = source.colorSpace ? source.colorSpace : ''
      texture.anisotropy = 8
      texture.userData.resource = resource
      texture.needsUpdate = true

      resourceStorage.addTexture(texture)

      return imageBitmap
    } catch (e) {
      console.log(e)
    }
  }
}

export { ImageBitmapManager }
