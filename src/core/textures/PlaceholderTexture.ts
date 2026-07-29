import { CanvasTexture, Texture } from 'three'

/**
 * Разделяемая заглушка для текстур, которые не удалось загрузить.
 *
 * Одна на приложение, создаётся лениво. Прежняя `ResourceStorage.generateTexture`
 * порождала НОВУЮ текстуру на каждый промах — она не кешировалась, не
 * переиспользовалась и не освобождалась.
 *
 * Заглушка НЕ регистрируется в реестре ресурсов и потому не попадает под
 * `deleteAllTextures()`. Это намеренно: ресурс уровня приложения, разделяемый
 * всеми материалами. Освободи её разборка сценария — и после первого же
 * переключения все, кто на неё смотрит, получили бы освобождённую текстуру.
 * Тот же паттерн и та же причина, что у `BlackHoleNoiseTexture`.
 */
class PlaceholderTexture {
  private static texture: Texture | null = null

  private static readonly SIZE: number = 64
  private static readonly COLOR: string = '#cccccc'

  public static get(): Texture {
    if (!this.texture) this.texture = this.generate()

    return this.texture
  }

  private static generate(): Texture {
    const canvas: HTMLCanvasElement = document.createElement('canvas')
    canvas.width = canvas.height = this.SIZE

    const context: CanvasRenderingContext2D = canvas.getContext('2d')!
    context.fillStyle = this.COLOR
    context.fillRect(0, 0, this.SIZE, this.SIZE)

    const texture: CanvasTexture = new CanvasTexture(canvas)
    texture.name = '__placeholder__'
    texture.needsUpdate = true

    return texture
  }
}

export { PlaceholderTexture }
