import { injectable } from 'inversify'
import { ResourceManager } from '@/core/services/ResourceManager'
import { IResource } from '@/core/models/types'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader'
import { threeJS } from '@/core/graphic/ThreeJS'
import { CompressedTexture } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'

@injectable()
class CompressedTextureManager extends ResourceManager<IResource> {
  protected loader: KTX2Loader

  public constructor() {
    super()
    this.loader = new KTX2Loader()
    this.loader.detectSupport(threeJS.renderer)
    this.loader.setTranscoderPath('examples/jsm/libs/basis/')
  }

  public async load(source: IResource): Promise<CompressedTexture | undefined> {
    try {
      const fullURL: string = this.getFullURL(source.path)
      const texture: CompressedTexture = await this.loader.loadAsync(fullURL)

      texture.name = source.path
      texture.colorSpace = source.colorSpace ? source.colorSpace : ''
      texture.anisotropy = Math.min(8, threeJS.renderer.capabilities.getMaxAnisotropy())

      resourceStorage.addTexture(texture)

      return texture
    } catch (e) {
      console.log(e)
    }
  }
}

export { CompressedTextureManager }
