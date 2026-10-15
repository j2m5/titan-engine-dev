import type { Texture } from 'three'
import { Collection } from '@/core/framework/support/Collection'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'
import type { CloudSourceStamp } from '@/core/clouds/CloudSources'

class ResourceStorage {
  private _textures: Collection<Texture> = new Collection()
  private readonly textureRevisions = new Map<string, number>()
  private readonly textureListeners = new Set<(key: string) => void>()

  private notifyTextureChange(key: string): void {
    this.textureRevisions.set(key, (this.textureRevisions.get(key) ?? 0) + 1)
    for (const listener of this.textureListeners) listener(key)
  }

  public getTextureSnapshot(key: string): CloudSourceStamp | undefined {
    const texture = this.getTexture(key)
    return texture
      ? {
          texture,
          image: texture.image,
          revision: this.textureRevisions.get(key) ?? 0,
          textureVersion: texture.version,
          sourceVersion: texture.source.version
        }
      : undefined
  }

  public subscribeTextureChanges(listener: (key: string) => void): () => void {
    this.textureListeners.add(listener)
    return () => {
      this.textureListeners.delete(listener)
    }
  }

  public get textures(): Collection<Texture> {
    return this._textures
  }

  public getTexture(key: string): Texture | undefined {
    return this._textures.where('name', key).first()
  }

  /**
   * Возвращает зарегистрированную текстуру по ключу, либо разделяемую
   * заглушку приложения (`PlaceholderTexture`), если ключ не найден.
   *
   * Раньше промах порождал НОВУЮ 64x64 CanvasTexture на каждый вызов
   * (`ResourceStorage.generateTexture`) — она не кешировалась и никогда не
   * освобождалась. Теперь на любое число промахов приходится один и тот же
   * объект уровня приложения; он никогда не регистрируется в этом хранилище
   * и потому не участвует в `deleteAllTextures()`.
   */
  public getTextureOrMake(key: string): Texture {
    return this.getTexture(key) ?? PlaceholderTexture.get()
  }

  public getCountTextures(): number {
    return this._textures.count()
  }

  public addTexture(texture: Texture): void {
    this._textures.push(texture)
    this.notifyTextureChange(texture.name)
  }

  /**
   * Диспоузит КАЖДУЮ текстуру с этим именем, а не только первую найденную.
   *
   * Реестр не гарантирует уникальность имени сам по себе — конкурентная
   * загрузка одного пути двумя акторами одного цикла (см. `ResourceObserver.
   * loadPath`, `pathLoads`) в принципе может оставить два объекта `Texture`
   * под одним именем, если что-то в цепочке дедупликации однажды не
   * сработает. Раньше `dispose()` вызывался только у первого совпадения по
   * `getTexture`, а `reject` убирал из коллекции ВСЕ совпадения разом — вторая
   * текстура выпадала из реестра недиспоузнутой и недостижимой: `deleteAllTextures()`
   * при разборке сценария больше не мог её найти. Утечка ровно того ресурса,
   * ради учёта которого существует эта арка.
   */
  public deleteTexture(key: string): void {
    if (!this.isExistsTexture(key)) return
    this.notifyTextureChange(key)
    this._textures.where('name', key).each((texture: Texture): void => {
      texture.dispose()
    })

    this._textures = this._textures.reject((texture: Texture): boolean => texture.name === key)
  }

  public deleteAllTextures(): void {
    const keys = new Set<string>()
    this._textures.each((texture: Texture): void => {
      keys.add(texture.name)
    })
    for (const key of keys) this.notifyTextureChange(key)
    this._textures.each((texture: Texture): void => {
      texture.dispose()
    })

    this._textures = new Collection()
  }

  public isExistsTexture(key: string): boolean {
    return this._textures.contains('name', '===', key)
  }
}

export const resourceStorage: ResourceStorage = new ResourceStorage()
