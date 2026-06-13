import dayjs from 'dayjs'
import type { Loader } from 'three'
import { FileSystemDrivers } from '@/config/filesystem'
import { config } from '@/core/framework/config'
import { Storage } from '@/core/framework/file/Storage'
import { resourceStorage } from '@/core/services/ResourceStorage'

export type ResourceDriverType = 'default' | 'cube' | 'bitmap' | 'compressed'

export interface ResourceItem {
  actorId: number | null
  type: ResourceDriverType
  loadedAt: dayjs.Dayjs
  expiredAt: dayjs.Dayjs
}

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
    resourceStorage.deleteTexture(key)
  }

  public removeAll(): void {
    resourceStorage.deleteAllTextures()
  }

  protected getFullURL(relativePath: string): string {
    return Storage.url(relativePath)
  }
}

export { ResourceManager }
