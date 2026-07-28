import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from 'vitest'
import { CubeTexture, CubeTextureLoader, ImageBitmapLoader, Texture } from 'three'
import type { WebGLRenderer } from 'three'
import { TextureProvider } from '@/core/textures/TextureProvider'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'
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

/**
 * jsdom не определяет `createImageBitmap` — конструктор `ImageBitmapLoader`
 * при его отсутствии печатает `console.warn`. Тесты ниже вызывают
 * `ImageBitmapStrategy.create()` не подставным, а настоящим `ImageBitmapLoader`
 * (иначе не проверить ни дефолтный порядок стратегий, ни реальные опции
 * декода), поэтому глобал подставляется на время теста — тем же приёмом,
 * каким сам `ImageBitmapLoader` проверяет его наличие.
 */
function withCreateImageBitmapStub<T>(run: () => T): T {
  const original = globalThis.createImageBitmap
  globalThis.createImageBitmap = (() => Promise.resolve({}) as unknown) as typeof globalThis.createImageBitmap

  try {
    return run()
  } finally {
    globalThis.createImageBitmap = original
  }
}

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

  it('без явного списка стратегий шестигранный запрос не достаётся растровой стратегии', async () => {
    // Регрессия на порядок стратегий: если бы ImageBitmapStrategy шла первой
    // (или CubeStrategy отсутствовала бы в дефолтном списке до CubeStrategy),
    // шестигранный запрос из .jpg-путей рисковал бы уйти растровому
    // загрузчику вместо кубического. loadAsync подменён на этапе сети —
    // jsdom не умеет ни живой fetch картинок, ни настоящую декодировку
    // битмапа, — но supports()/выбор стратегии остаются настоящими.
    const cubeLoadAsync = vi.spyOn(CubeTextureLoader.prototype, 'loadAsync').mockResolvedValue(new CubeTexture())
    const imageLoadAsync = vi
      .spyOn(ImageBitmapLoader.prototype, 'loadAsync')
      .mockRejectedValue(new Error('растровая стратегия не должна вызываться для кубмапы'))

    try {
      const { renderer } = rendererSpy()
      const provider = withCreateImageBitmapStub(() => new TextureProvider(renderer))

      const result = await provider.load(cube())

      expect(cubeLoadAsync).toHaveBeenCalled()
      expect(imageLoadAsync).not.toHaveBeenCalled()
      expect(result.ok).toBe(true)
    } finally {
      cubeLoadAsync.mockRestore()
      imageLoadAsync.mockRestore()
    }
  })

  it('ImageBitmapStrategy.create() включает переворот на этапе декода', () => {
    // three хранит опции загрузчика как есть — см. ImageBitmapLoader.js:
    // setOptions(options) { this.options = options }. Для источника ImageBitmap
    // рендерер three игнорирует texture.flipY, поэтому переворот обязан быть
    // выставлен именно тут, на loader.options, а не понадеявшись на дефолт.
    const setOptionsSpy = vi.spyOn(ImageBitmapLoader.prototype, 'setOptions')

    try {
      withCreateImageBitmapStub(() => ImageBitmapStrategy.create())

      expect(setOptionsSpy).toHaveBeenCalledWith(expect.objectContaining({ imageOrientation: 'flipY' }))
    } finally {
      setOptionsSpy.mockRestore()
    }
  })
})
