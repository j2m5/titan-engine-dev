import { injectable } from 'inversify'
import { ResourceManager } from '@/core/services/ResourceManager'
import { CubeTexture, CubeTextureLoader } from 'three'
import { IResource } from '@/core/models/types'
import { threeJS } from '@/core/graphic/ThreeJS'
import { Storage } from '@/core/framework/file/Storage'
import { resourceStorage } from '@/core/services/ResourceStorage'

@injectable()
class CubeMapTextureManager extends ResourceManager<IResource[], CubeTexture, readonly string[]> {
  protected loader: CubeTextureLoader

  public constructor() {
    super()
    this.loader = new CubeTextureLoader()
  }

  public override async loadAll(sources: Array<IResource[]>): Promise<void> {
    const loadPromises: Promise<CubeTexture | undefined>[] = sources.map((source: IResource[]) => this.load(source))
    await Promise.all(loadPromises)
  }

  public override async load(source: IResource[]): Promise<CubeTexture | undefined> {
    try {
      const first: string = source[0].path
      const name: string = first.replace(/(.*)\/.*?\..*$/, '$1').replace(/\//g, '-')
      const fullURLs: string[] = this.getFullURLs(source.map((item: IResource) => item.path))
      const texture: CubeTexture = await this.loader.loadAsync(fullURLs)

      texture.name = name
      texture.anisotropy = 8

      resourceStorage.addTexture(texture)

      threeJS.renderer.initTexture(texture)

      return texture
    } catch (e) {
      console.log(e)
    }
  }

  private getFullURLs(urls: string[]): string[] {
    return urls.map((url: string): string => Storage.url(url))
  }
}

export { CubeMapTextureManager }
