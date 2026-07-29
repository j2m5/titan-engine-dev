import type { Texture } from 'three'
import { Collection } from '@/core/framework/support/Collection'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'

class ResourceStorage {
  private _textures: Collection<Texture> = new Collection()

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
  }

  public deleteTexture(key: string): void {
    const texture: Texture | undefined = this.getTexture(key)

    if (texture) {
      texture.dispose()
    }

    this._textures = this._textures.reject((texture: Texture): boolean => texture.name === key)
  }

  public deleteAllTextures(): void {
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
