import { ResourceManager } from '@/core/services/ResourceManager'
import { IResource } from '@/core/models/types'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader'
import { threeJS } from '@/core/graphic/ThreeJS'
import { CompressedTexture } from 'three'
import { addTexture } from '@/config/textures'

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
      const regex: RegExp = /(?:.+\/)?([a-zA-Z0-9_-]+\.?:ktx2)/
      const fullURL: string = this.getFullURL(source.path)
      const match: RegExpMatchArray | null = fullURL.match(regex)
      const fileName: string = match ? match[1] : ''
      const texture: CompressedTexture = await this.loader.loadAsync(fullURL)

      texture.name = fileName
      texture.colorSpace = source.colorSpace ? source.colorSpace : ''
      texture.anisotropy = Math.min(8, threeJS.renderer.capabilities.getMaxAnisotropy())

      addTexture(source.path, texture)

      return texture
    } catch (e) {
      console.log(e)
    }
  }
}

export { CompressedTextureManager }
