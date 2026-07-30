import type { Texture } from 'three'

/** Байт на тексель у RGBA8 — единственный формат, в который распаковываются JPG и PNG. */
const BYTES_PER_TEXEL: number = 4

/** Полная пирамида мипов добавляет к базовому уровню примерно треть. */
const MIPMAP_FACTOR: number = 4 / 3

/**
 * Вес текстуры в видеопамяти.
 *
 * Зависит ТОЛЬКО от разрешения: сжатие исходного файла на него не влияет,
 * потому что JPG распаковывается полностью. Файл на 2 МБ и файл на 20 МБ при
 * одном разрешении занимают одинаково.
 */
export function textureBytes(width: number, height: number): number {
  return Math.round(width * height * BYTES_PER_TEXEL * MIPMAP_FACTOR)
}

/**
 * Учёт видеопамяти под стримируемые текстуры.
 *
 * Размер измеряется по факту загрузки и кешируется по пути на всю сессию:
 * узнать его заранее нельзя, а тащить разрешения в данные — 124 строки плюс
 * редактор, валидатор и генератор ради числа, которое измеряется само.
 * Первый визит к телу идёт вслепую (решение берёт оценку), все последующие —
 * со знанием.
 *
 * Бюджет самоназначенный: WebGL не умеет спрашивать, сколько видеопамяти
 * занято или свободно, — такого API нет, а `renderer.info.memory.textures`
 * даёт счётчик штук, а не байты.
 */
class TextureBudget {
  private readonly sizes: Map<string, number> = new Map()

  public constructor(private readonly limitBytes: number) {}

  /**
   * Запомнить вес загруженной текстуры. Текстура без размеров изображения
   * игнорируется: записать ей ноль означало бы считать её бесплатной.
   */
  public measure(path: string, texture: Texture): void {
    const image: { width?: number; height?: number } | undefined = texture.image

    if (!image || !image.width || !image.height) return

    this.sizes.set(path, textureBytes(image.width, image.height))
  }

  public sizeOf(path: string): number | undefined {
    return this.sizes.get(path)
  }

  public forget(path: string): void {
    this.sizes.delete(path)
  }

  public limit(): number {
    return this.limitBytes
  }
}

export { TextureBudget }
