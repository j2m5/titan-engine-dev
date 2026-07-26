import { ResourceManager } from '@/core/services/ResourceManager'
import { Texture, TextureLoader, WebGLRenderer } from 'three'
import { IResource } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'

class TextureManager extends ResourceManager<IResource, Texture> {
  protected loader: TextureLoader

  public constructor(private readonly renderer: WebGLRenderer) {
    super()
    this.loader = new TextureLoader()
  }

  public async load(source: IResource): Promise<Texture | undefined> {
    try {
      const fullURL: string = this.getFullURL(source.path)
      const texture: Texture = await this.loader.loadAsync(fullURL)

      texture.name = source.path
      texture.colorSpace = source.colorSpace ? source.colorSpace : ''
      texture.anisotropy = 8

      resourceStorage.addTexture(texture)

      this.renderer.initTexture(texture)

      return texture
    } catch (e) {
      console.log(e)
    }
  }
}

export { TextureManager }
