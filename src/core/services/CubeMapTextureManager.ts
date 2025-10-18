import { ResourceManager } from '@/core/services/ResourceManager.ts'
import { CubeTexture, CubeTextureLoader, Texture } from 'three'
import { IResource } from '@/core/models/types'
import {
  addTexture,
  deleteTextureByKey,
  getLoadedTextures,
  getTextureByKey,
  getTexturesDirname
} from '@/config/textures.ts'
import { threeJS } from '@/core/graphic/ThreeJS'
import { injectable } from 'inversify'

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
      console.log(name)

      texture.name = name
      texture.anisotropy = 8

      addTexture(name, texture)

      threeJS.renderer.initTexture(texture)

      return texture
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
      this.remove(key)
    })
  }

  private getFullURLs(urls: string[]): string[] {
    return urls.map((url: string): string => `/images/${getTexturesDirname()}/${url}`)
  }
}

export { CubeMapTextureManager }
