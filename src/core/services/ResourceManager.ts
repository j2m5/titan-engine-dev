import type { Loader } from 'three'
import { deleteTextureByKey, getLoadedTextures, getTextureByKey } from '@/config/textures'
import { Texture } from 'three'
import { FileSystemDrivers } from '@/config/filesystem'
import { config } from '@/core/framework/config'
import { Storage } from '@/core/framework/file/Storage'

abstract class ResourceManager<TSource, TData = unknown, TUrl = string> {
  public driver: FileSystemDrivers
  protected abstract loader: Loader<TData, TUrl>

  protected constructor() {
    this.driver = config('driver')
  }

  public abstract load(source: TSource): Promise<TData | undefined>

  public async loadAll(sources: TSource[]): Promise<void> {
    const loadPromises: Promise<TData | undefined>[] = sources.map((source: TSource) => this.load(source))
    await Promise.all(loadPromises)
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

  protected getFullURL(url: string): string {
    return Storage.url(url)
  }
}

export { ResourceManager }
