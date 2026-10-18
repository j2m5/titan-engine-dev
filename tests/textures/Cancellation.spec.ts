import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoadingManager, Texture, type WebGLRenderer } from 'three'
import { TextureProvider } from '@/core/textures/TextureProvider'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import { CubeStrategy } from '@/core/textures/strategies/CubeStrategy'
import { BitmapTransport } from '@/core/textures/BitmapTransport'
import type { TextureRequest } from '@/core/textures/types'

const request: TextureRequest = { paths: ['owned.png'], name: 'owned', resourceType: 'diffuse', params: {} }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('per-request texture cancellation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('checks cancellation immediately before GPU upload', async () => {
    const controller = new AbortController()
    const initTexture = vi.fn()
    const texture = new Texture()
    const dispose = vi.spyOn(texture, 'dispose')
    const provider = new TextureProvider({ initTexture, capabilities: {
      getMaxAnisotropy: () => { controller.abort(); return 8 }
    } } as unknown as WebGLRenderer, [{ supports: () => true, load: async () => texture }])
    await expect(provider.load(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(initTexture).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not start transport for an already cancelled request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort('gone')
    await expect(ImageBitmapStrategy.create().load(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports genuine HTTP failure once and balances URL-resolved manager accounting', async () => {
    const manager = new LoadingManager()
    manager.setURLModifier(() => '/resolved.png')
    const start = vi.spyOn(manager, 'itemStart')
    const end = vi.spyOn(manager, 'itemEnd')
    const error = vi.spyOn(manager, 'itemError')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    await expect(new BitmapTransport(manager).loadAsync('/original.png')).rejects.toThrow('404')
    expect(start).toHaveBeenCalledExactlyOnceWith('/resolved.png')
    expect(end).toHaveBeenCalledExactlyOnceWith('/resolved.png')
    expect(error).toHaveBeenCalledExactlyOnceWith('/resolved.png')
  })

  it('rejects cancellation without uploading or allocating a fallback and disposes late strategy success', async () => {
    const controller = new AbortController()
    const pending = deferred<Texture>()
    const texture = new Texture()
    const dispose = vi.spyOn(texture, 'dispose')
    const initTexture = vi.fn()
    const provider = new TextureProvider({ initTexture, capabilities: { getMaxAnisotropy: () => 8 } } as unknown as WebGLRenderer, [
      { supports: () => true, load: () => pending.promise }
    ])
    const result = provider.load(request, controller.signal)
    controller.abort(new Error('scenario left'))
    pending.resolve(texture)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(dispose).toHaveBeenCalledOnce()
    expect(initTexture).not.toHaveBeenCalled()
  })

  it('aborts real transport and balances manager accounting without reporting an error', async () => {
    const manager = new LoadingManager()
    const error = vi.spyOn(manager, 'itemError')
    const end = vi.spyOn(manager, 'itemEnd')
    const controller = new AbortController()
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetch)
    const result = ImageBitmapStrategy.create(manager).load(request, controller.signal)
    void result.catch(() => undefined)
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
    expect(end).toHaveBeenCalledOnce()
    expect(error).not.toHaveBeenCalled()
  })

  it('closes a bitmap decoded after abort exactly once', async () => {
    const decode = deferred<ImageBitmap>()
    const decoding = deferred<void>()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })))
    vi.stubGlobal('createImageBitmap', vi.fn(() => { decoding.resolve(); return decode.promise }))
    const controller = new AbortController()
    const result = ImageBitmapStrategy.create().load(request, controller.signal)
    await decoding.promise
    controller.abort()
    const close = vi.fn()
    decode.resolve({ close } as unknown as ImageBitmap)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes completed and late cube faces after a genuine partial failure', async () => {
    const late = deferred<ImageBitmap>()
    const close = vi.fn()
    const lateClose = vi.fn()
    let calls = 0
    const loader = { loadAsync: async () => {
      const index = calls++
      if (index === 0) return { close } as unknown as ImageBitmap
      if (index === 1) throw new Error('face failed')
      return late.promise
    } }
    const result = new CubeStrategy(loader).load({ ...request, paths: Array(6).fill('face.png') })
    late.resolve({ close: lateClose } as unknown as ImageBitmap)
    await expect(result).rejects.toThrow('face failed')
    expect(close).toHaveBeenCalledOnce()
    // One independently owned bitmap per load; this fixture deliberately shares a source.
    expect(lateClose).toHaveBeenCalledOnce()
  })

  it('cancels every cube face and closes independent late decodes exactly once', async () => {
    const faces = Array.from({ length: 6 }, () => ({ ...deferred<ImageBitmap>(), close: vi.fn() }))
    const signals: (AbortSignal | undefined)[] = []
    const controller = new AbortController()
    const loader = { loadAsync: (_url: string, signal?: AbortSignal) => {
      const index = signals.length
      signals.push(signal)
      return faces[index].promise
    } }
    const loading = new CubeStrategy(loader).load({ ...request, paths: Array(6).fill('face.png') }, controller.signal)
    controller.abort(new Error('scenario changed'))
    expect(signals).toHaveLength(6)
    expect(signals.every((signal) => signal?.aborted)).toBe(true)
    for (const face of faces) face.resolve({ close: face.close } as unknown as ImageBitmap)
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    for (const face of faces) expect(face.close).toHaveBeenCalledOnce()
  })
})
