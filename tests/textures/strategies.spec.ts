import { describe, it, expect, vi } from 'vitest'
import { CubeTexture } from 'three'
import type { CubeTextureLoader, ImageBitmapLoader } from 'three'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import { CubeStrategy } from '@/core/textures/strategies/CubeStrategy'
import type { TextureRequest } from '@/core/textures/types'

const CUBE_FACES: string[] = [
  'cubemaps/scene/main/px.jpg',
  'cubemaps/scene/main/nx.jpg',
  'cubemaps/scene/main/py.jpg',
  'cubemaps/scene/main/ny.jpg',
  'cubemaps/scene/main/pz.jpg',
  'cubemaps/scene/main/nz.jpg'
]

function single(path: string): TextureRequest {
  return { paths: [path], name: path, params: {}, resourceType: 'diffuse' }
}

function cube(): TextureRequest {
  return { paths: CUBE_FACES, name: 'cubemaps-scene-main', params: {}, resourceType: 'cube' }
}

/** jsdom не умеет createImageBitmap — загрузчик подменяется целиком. */
function bitmapLoaderReturning(bitmap: ImageBitmap): ImageBitmapLoader {
  return { loadAsync: vi.fn(() => Promise.resolve(bitmap)) } as unknown as ImageBitmapLoader
}

describe('ImageBitmapStrategy', () => {
  it('берёт одиночные растровые пути', () => {
    const strategy = new ImageBitmapStrategy(bitmapLoaderReturning({} as ImageBitmap))

    expect(strategy.supports(single('planets/earth.jpg'))).toBe(true)
    expect(strategy.supports(single('planets/earth.PNG'))).toBe(true)
    expect(strategy.supports(single('planets/earth.webp'))).toBe(true)
  })

  it('не берёт шестёрку граней и незнакомые расширения', () => {
    const strategy = new ImageBitmapStrategy(bitmapLoaderReturning({} as ImageBitmap))

    expect(strategy.supports(cube())).toBe(false)
    expect(strategy.supports(single('planets/earth.ktx2'))).toBe(false)
  })

  it('оборачивает битмап в текстуру', async () => {
    const bitmap = { width: 2, height: 2 } as ImageBitmap
    const strategy = new ImageBitmapStrategy(bitmapLoaderReturning(bitmap))

    const texture = await strategy.load(single('planets/earth.jpg'))

    expect(texture.image).toBe(bitmap)
  })

  it('пробрасывает сбой загрузчика наружу', async () => {
    const loader = { loadAsync: vi.fn(() => Promise.reject(new Error('404'))) } as unknown as ImageBitmapLoader
    const strategy = new ImageBitmapStrategy(loader)

    await expect(strategy.load(single('planets/earth.jpg'))).rejects.toThrow('404')
  })
})

describe('CubeStrategy', () => {
  it('берёт ровно шестёрку граней', () => {
    const loader = { loadAsync: vi.fn(() => Promise.resolve(new CubeTexture())) } as unknown as CubeTextureLoader
    const strategy = new CubeStrategy(loader)

    expect(strategy.supports(cube())).toBe(true)
    expect(strategy.supports(single('planets/earth.jpg'))).toBe(false)
  })

  it('отдаёт загрузчику все шесть путей в исходном порядке', async () => {
    const loadAsync = vi.fn<(urls: string[]) => Promise<CubeTexture>>(() => Promise.resolve(new CubeTexture()))
    const strategy = new CubeStrategy({ loadAsync } as unknown as CubeTextureLoader)

    await strategy.load(cube())

    const passed = loadAsync.mock.calls[0][0] as unknown as string[]
    expect(passed).toHaveLength(6)
    expect(passed[0]).toContain('px.jpg')
    expect(passed[5]).toContain('nz.jpg')
  })
})
