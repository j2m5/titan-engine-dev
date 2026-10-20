import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasTexture, MeshBasicMaterial, Texture, type WebGLRenderer } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import { TextureProvider } from '@/core/textures/TextureProvider'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'
import type { TextureRequest } from '@/core/textures/types'

const request: TextureRequest = { paths: ['owned.png'], name: 'owned.png', resourceType: 'diffuse', params: {} }

async function raster() {
  const close = vi.fn()
  const bitmap = { width: 2, height: 2, close } as unknown as ImageBitmap
  const strategy = new ImageBitmapStrategy({ loadAsync: async () => bitmap })
  return { close, texture: await strategy.load(request) }
}

describe('raster bitmap final ownership', () => {
  let fallback: Texture
  beforeAll(() => {
    const create = vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: () => undefined })
    } as unknown as HTMLCanvasElement)
    try { fallback = PlaceholderTexture.get() } finally { create.mockRestore() }
  })
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    vi.restoreAllMocks()
  })

  it('keeps the bitmap through upload and material sharing, closes once at storage eviction', async () => {
    const { close, texture } = await raster()
    const renderer = {
      capabilities: { getMaxAnisotropy: () => 8 },
      initTexture: () => { expect(close).not.toHaveBeenCalled() }
    } as unknown as WebGLRenderer
    const provider = new TextureProvider(renderer, [{ supports: () => true, load: async () => texture }])
    const result = await provider.load(request)
    expect(result).toEqual({ ok: true, texture })
    expect(texture).toBeInstanceOf(CanvasTexture)
    resourceStorage.addTexture(texture)
    const first = new MeshBasicMaterial({ map: texture })
    const second = new MeshBasicMaterial({ map: texture })
    first.dispose()
    expect(second.map).toBe(texture)
    expect(close).not.toHaveBeenCalled()
    resourceStorage.deleteTexture(request.name)
    expect(close).toHaveBeenCalledOnce()
    texture.dispose()
    expect(close).toHaveBeenCalledOnce()
    second.dispose()
  })

  it('closes registered raster sources during storage teardown', async () => {
    const { close, texture } = await raster()
    resourceStorage.addTexture(texture)
    resourceStorage.deleteAllTextures()
    expect(close).toHaveBeenCalledOnce()
  })

  it.each(['parameters', 'upload'] as const)('disposes the loaded bitmap after %s failure', async (stage) => {
    const { close, texture } = await raster()
    const failure = new Error(stage)
    const renderer = {
      capabilities: { getMaxAnisotropy: () => { if (stage === 'parameters') throw failure; return 8 } },
      initTexture: () => { throw failure }
    } as unknown as WebGLRenderer
    const fallbackDispose = vi.spyOn(fallback, 'dispose')
    const result = await new TextureProvider(renderer, [{ supports: () => true, load: async () => texture }]).load(request)
    expect(result).toEqual({ ok: false, texture: fallback, error: failure })
    expect(close).toHaveBeenCalledOnce()
    expect(fallbackDispose).not.toHaveBeenCalled()
  })

  it('does not dispose the shared placeholder returned by a strategy on post-load failure', async () => {
    const failure = new Error('upload')
    const dispose = vi.spyOn(fallback, 'dispose')
    const renderer = {
      capabilities: { getMaxAnisotropy: () => 8 }, initTexture: () => { throw failure }
    } as unknown as WebGLRenderer
    const result = await new TextureProvider(renderer, [{ supports: () => true, load: async () => fallback }]).load(request)
    expect(result).toEqual({ ok: false, texture: fallback, error: failure })
    expect(dispose).not.toHaveBeenCalled()
  })
})
