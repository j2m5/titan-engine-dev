import type { Texture } from 'three'
import { Collection } from '@/core/framework/support/Collection'
import { CanvasTexture } from 'three'

class ResourceStorage {
  private _textures: Collection<Texture> = new Collection()

  public static generateTexture(color: string = '#cccccc'): Texture {
    const size: number = 64
    const canvas: HTMLCanvasElement = document.createElement('canvas')
    canvas.width = canvas.height = size

    const context: CanvasRenderingContext2D = canvas.getContext('2d')!
    context.fillStyle = color
    context.fillRect(0, 0, size, size)

    const texture: CanvasTexture = new CanvasTexture(canvas)
    texture.needsUpdate = true

    return texture
  }

  public get textures(): Collection<Texture> {
    return this._textures
  }

  public getTexture(key: string): Texture | undefined {
    return this._textures.where('name', key).first()
  }

  public getTextureOrMake(key: string, fallback?: (color?: string) => Texture): Texture {
    fallback = fallback ?? ResourceStorage.generateTexture

    return this.getTexture(key) ?? fallback()
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
