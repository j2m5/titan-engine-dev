import { ResourceManager } from '@/core/services/ResourceManager'
import { Texture, TextureLoader } from 'three'
import { IResource } from '@/core/models/types'
import { addTexture } from '@/config/textures'
import { threeJS } from '@/core/graphic/ThreeJS'

class TextureManager extends ResourceManager<IResource, Texture> {
  protected loader: TextureLoader

  public constructor() {
    super()
    this.loader = new TextureLoader()
  }

  public async load(source: IResource): Promise<Texture | undefined> {
    try {
      const regex: RegExp = /(?:.+\/)?([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|gif|bmp|svg|webp))/
      const fullURL: string = this.getFullURL(source.path)
      const match: RegExpMatchArray | null = fullURL.match(regex)
      const imageName: string = match ? match[1] : ''
      const texture: Texture = await this.loader.loadAsync(fullURL)

      texture.name = imageName
      texture.colorSpace = source.colorSpace ? source.colorSpace : ''
      texture.anisotropy = 8

      addTexture(source.path, texture)

      threeJS.renderer.initTexture(texture)

      return texture
    } catch (e) {
      console.log(e)
    }
  }
}

export { TextureManager }
