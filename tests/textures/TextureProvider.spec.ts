import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from 'vitest'
import { CubeTexture, SRGBColorSpace, Texture } from 'three'
import type { WebGLRenderer } from 'three'
import { TextureProvider } from '@/core/textures/TextureProvider'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'
import { BitmapTransport } from '@/core/textures/BitmapTransport'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import type { TextureLoadStrategy, TextureRequest } from '@/core/textures/types'

/**
 * jsdom без node-canvas не умеет 2D-контекст (см. tests/textures/
 * PlaceholderTexture.spec.ts — тот же приём). Провал обычной текстуры в
 * TextureProvider.load() достаёт PlaceholderTexture.get(), которая без стаба
 * canvas.getContext('2d') упадёт на context.fillStyle.
 */
const stubCanvas = (): HTMLCanvasElement =>
  ({
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: '', fillRect: () => undefined })
  }) as unknown as HTMLCanvasElement

function rendererSpy(): { renderer: WebGLRenderer; initTexture: ReturnType<typeof vi.fn> } {
  const initTexture = vi.fn()
  const renderer = {
    initTexture,
    capabilities: { getMaxAnisotropy: () => 8 }
  } as unknown as WebGLRenderer

  return { renderer, initTexture }
}

function single(path: string = 'planets/earth.jpg'): TextureRequest {
  return { paths: [path], name: path, params: {}, resourceType: 'diffuse' }
}

function cube(): TextureRequest {
  return { paths: Array.from({ length: 6 }, (_, i) => `c/f${i}.jpg`), name: 'c', params: {}, resourceType: 'cube' }
}

function okStrategy(texture: Texture): TextureLoadStrategy {
  return { supports: () => true, load: () => Promise.resolve(texture) }
}

function failingStrategy(error: Error): TextureLoadStrategy {
  return { supports: () => true, load: () => Promise.reject(error) }
}

describe('TextureProvider', () => {
  let createElementSpy: MockInstance | null = null

  beforeAll(() => {
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas())
  })

  afterAll(() => {
    createElementSpy?.mockRestore()
  })

  it('успех: возвращает текстуру с ok, применяет параметры и заливает в GPU', async () => {
    const { renderer, initTexture } = rendererSpy()
    const texture = new Texture()
    const provider = new TextureProvider(renderer, [okStrategy(texture)])

    const result = await provider.load(single())

    expect(result.ok).toBe(true)
    expect(result.texture).toBe(texture)
    expect(texture.name).toBe('planets/earth.jpg')
    expect(initTexture).toHaveBeenCalledWith(texture)
  })

  it('сбой обычной текстуры: отдаёт разделяемую заглушку и ok=false', async () => {
    const { renderer } = rendererSpy()
    const provider = new TextureProvider(renderer, [failingStrategy(new Error('404'))])

    const result = await provider.load(single())

    expect(result.ok).toBe(false)
    // Узкий тип для .error: у ветки ok=true поля error нет вовсе (см. LoadResult
    // в types.ts), поэтому доступ требует сужения через `if (!result.ok)` —
    // тот самый инвариант, который задокументирован там же для потребителей.
    if (result.ok) throw new Error('ожидался провал загрузки')
    expect(result.texture).toBe(PlaceholderTexture.get())
    expect(result.error.message).toBe('404')
  })

  it('два сбоя подряд дают ОДНУ И ТУ ЖЕ заглушку', async () => {
    const { renderer } = rendererSpy()
    const provider = new TextureProvider(renderer, [failingStrategy(new Error('404'))])

    const first = await provider.load(single('a.jpg'))
    const second = await provider.load(single('b.jpg'))

    expect(first.texture).toBe(second.texture)
  })

  it('заглушка не заливается в GPU и не получает имя провалившегося ресурса', async () => {
    // Иначе разделяемая заглушка переименовывалась бы под каждый промах,
    // а resourceStorage.getTexture начал бы находить её по чужому ключу.
    const { renderer, initTexture } = rendererSpy()
    const provider = new TextureProvider(renderer, [failingStrategy(new Error('404'))])

    const result = await provider.load(single('planets/mars.jpg'))

    expect(result.texture?.name).toBe('__placeholder__')
    expect(initTexture).not.toHaveBeenCalled()
  })

  it('провал не применяет параметры запроса к разделяемой заглушке', async () => {
    // Предыдущий тест проверяет только .name — applyTextureParameters тоже
    // переписывает .name, так что мутацию заглушки в других полях он не
    // заметил бы. Здесь проверяются два независимых поля (colorSpace и
    // anisotropy), которые применились бы, если бы провал по ошибке дёрнул
    // applyTextureParameters(placeholder, request, this.renderer) — иначе
    // разделяемая заглушка переняла бы настройки последнего провалившегося
    // запроса, и следующий материал, который на неё смотрит, увидел бы чужой
    // colorSpace/anisotropy.
    const placeholder = PlaceholderTexture.get()
    const ownColorSpace = placeholder.colorSpace
    const ownAnisotropy = placeholder.anisotropy

    const request: TextureRequest = {
      paths: ['planets/venus.jpg'],
      name: 'planets/venus.jpg',
      params: { colorSpace: SRGBColorSpace, anisotropy: 4 },
      resourceType: 'diffuse'
    }

    // Параметры запроса обязаны реально отличаться от собственных значений
    // заглушки — иначе тест ничего бы не различал.
    expect(request.params.colorSpace).not.toBe(ownColorSpace)
    expect(request.params.anisotropy).not.toBe(ownAnisotropy)

    const { renderer } = rendererSpy()
    const provider = new TextureProvider(renderer, [failingStrategy(new Error('404'))])

    const result = await provider.load(request)

    expect(result.texture).toBe(placeholder)
    expect(placeholder.colorSpace).toBe(ownColorSpace)
    expect(placeholder.anisotropy).toBe(ownAnisotropy)
  })

  it('сбой кубмапы: ok=false БЕЗ текстуры', async () => {
    // Подменить CubeTexture обычной нечем, а путь и так терпит отсутствие:
    // sceneBackground объявлен CubeTexture | null.
    const { renderer } = rendererSpy()
    const provider = new TextureProvider(renderer, [failingStrategy(new Error('offline'))])

    const result = await provider.load(cube())

    expect(result.ok).toBe(false)
    expect(result.texture).toBeNull()
  })

  it('нет подходящей стратегии — бросает, а не маскирует заглушкой', async () => {
    // Опечатка в расширении — ошибка конфигурации, а не сбой загрузки.
    const { renderer } = rendererSpy()
    const provider = new TextureProvider(renderer, [])

    await expect(provider.load(single('planets/earth.tga'))).rejects.toThrow(/стратеги/i)
  })

  it('routes default cube requests through six unflipped bitmap loads', async () => {
    const load = vi.spyOn(BitmapTransport.prototype, 'loadAsync').mockImplementation(async () => ({ close: vi.fn() } as unknown as ImageBitmap))
    try {
      const { renderer } = rendererSpy()
      const result = await new TextureProvider(renderer).load(cube())
      expect(result.ok).toBe(true)
      expect(result.texture).toBeInstanceOf(CubeTexture)
      expect(load).toHaveBeenCalledTimes(6)
      for (const call of load.mock.calls) expect(call[2]).toEqual({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      result.texture?.dispose()
    } finally { load.mockRestore() }
  })

  it('decodes default raster textures flipped without premultiplication or color conversion', async () => {
    const load = vi.spyOn(BitmapTransport.prototype, 'loadAsync').mockResolvedValue({ close: vi.fn() } as unknown as ImageBitmap)
    try {
      const texture = await ImageBitmapStrategy.create().load(single())
      expect(load.mock.calls[0][2]).toEqual({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      texture.dispose()
    } finally { load.mockRestore() }
  })
})
