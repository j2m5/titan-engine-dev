import { describe, it, expect } from 'vitest'
import { Texture } from 'three'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'

/** Текстура с заданными размерами изображения — three не требует реальных данных. */
function textureSized(width: number, height: number): Texture {
  const texture = new Texture()
  texture.image = { width, height }

  return texture
}

/** Кубическая текстура — `image` это массив шести граней, у массива нет `.width`. */
function textureCube(): Texture {
  const texture = new Texture()
  texture.image = [{}, {}, {}, {}, {}, {}]

  return texture
}

describe('textureBytes', () => {
  it('считает RGBA8 плюс мипы', () => {
    // 2048 × 1024 × 4 = 8 МиБ; с мипами примерно на треть больше.
    expect(textureBytes(2048, 1024)).toBe(Math.round(2048 * 1024 * 4 * (4 / 3)))
  })

  it('8K дороже 2K в шестнадцать раз', () => {
    // Точное равенство недостижимо: Math.round вносит фиксированную поправку
    // (не масштабируемую вшестнадцатеро), потому что произведение степеней
    // двойки никогда не делится на 3 нацело — детерминированный дефицит в 5
    // байт из ~179 млн, проверено аналитически, не шум плавающей точки.
    expect(textureBytes(8192, 4096) / textureBytes(2048, 1024)).toBeCloseTo(16, 4)
  })
})

describe('TextureBudget', () => {
  it('запоминает вес по пути', () => {
    const budget = new TextureBudget(1024)

    budget.measure('planets/earth.jpg', textureSized(2048, 1024))

    expect(budget.sizeOf('planets/earth.jpg')).toBe(textureBytes(2048, 1024))
  })

  it('неизмеренный путь даёт undefined', () => {
    const budget = new TextureBudget(1024)

    expect(budget.sizeOf('planets/mars.jpg')).toBeUndefined()
  })

  it('текстура без размеров изображения не запоминается', () => {
    // jsdom и заглушки дают Texture без image; молча записать ноль означало бы
    // считать такую текстуру бесплатной и переполнить бюджет.
    const budget = new TextureBudget(1024)

    budget.measure('planets/mars.jpg', new Texture())

    expect(budget.sizeOf('planets/mars.jpg')).toBeUndefined()
  })

  it('кубическая текстура (массив граней) не запоминается', () => {
    // В этом проекте все кубические ресурсы объявлены resident и не участвуют
    // в бюджете стриминга — measure должен узнать массив граней и пропустить
    // его осознанно, а не случайно из-за отсутствующего .width у массива.
    const budget = new TextureBudget(1024)

    budget.measure('planets/skybox.jpg', textureCube())

    expect(budget.sizeOf('planets/skybox.jpg')).toBeUndefined()
  })

  it('лимит отдаётся как есть', () => {
    expect(new TextureBudget(4096).limit()).toBe(4096)
  })
})
