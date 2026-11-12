import { afterEach, describe, expect, it, vi } from 'vitest'
import { Texture, type WebGLRenderer } from 'three'
import {
  bindResourceStorageContext,
  getRendererContextGeneration,
  resourceStorage
} from '@/core/services/ResourceStorage'
import { Engine } from '@/core/Engine'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import { CubeStrategy } from '@/core/textures/strategies/CubeStrategy'

afterEach(() => resourceStorage.deleteAllTextures())
function renderer(lost = false) {
  return {
    domElement: document.createElement('canvas'),
    renderLists: { dispose: vi.fn() },
    getContext: () => ({ isContextLost: () => lost })
  } as unknown as WebGLRenderer
}
async function ownedTexture(kind: 'raster' | 'cube', name = 'context-bitmap') {
  const images = Array.from({ length: kind === 'cube' ? 6 : 1 }, () => {
    const image = { width: 2, height: 2, close: vi.fn() }
    image.close.mockImplementation(() => { image.width = image.height = 0 })
    return image
  })
  let next = 0
  const loader = { loadAsync: async () => images[next++] as unknown as ImageBitmap }
  const strategy = kind === 'cube' ? new CubeStrategy(loader) : new ImageBitmapStrategy(loader)
  const texture = await strategy.load({
    name, paths: images.map((_, face) => `${name}-${face}.png`), resourceType: kind === 'cube' ? 'cube' : 'diffuse', params: {}
  })
  texture.name = name
  resourceStorage.addTexture(texture)
  return { texture, images }
}

describe('resource owner context lifecycle', () => {
  it.each(['raster', 'cube'] as const)('preserves owned %s sources over repeated losses until final eviction', async (kind) => {
    const { texture, images } = await ownedTexture(kind)
    const active = renderer(), release = bindResourceStorageContext(active)
    const stamp = resourceStorage.getTextureSnapshot(texture.name)
    const gpuDisposals = vi.fn()
    texture.addEventListener('dispose', gpuDisposals)
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        active.domElement.dispatchEvent(new Event('webglcontextlost'))
        expect(images.map(image => image.width)).toEqual(kind === 'cube' ? [2, 2, 2, 2, 2, 2] : [2])
        active.domElement.dispatchEvent(new Event('webglcontextrestored'))
        expect(resourceStorage.getTextureSnapshot(texture.name)).toEqual(stamp)
        expect(resourceStorage.getTexture(texture.name)).toBe(texture)
      }
      expect(gpuDisposals).toHaveBeenCalledTimes(2)
      for (const image of images) expect(image.close).not.toHaveBeenCalled()
      resourceStorage.deleteTexture(texture.name)
      expect(images.map(image => image.width)).toEqual(kind === 'cube' ? [0, 0, 0, 0, 0, 0] : [0])
      texture.dispose()
      for (const image of images) expect(image.close).toHaveBeenCalledOnce()
    } finally {
      release()
    }
  })
  it('still closes a source when evicted while the context remains lost', async () => {
    const { texture, images } = await ownedTexture('raster')
    const active = renderer(), release = bindResourceStorageContext(active)
    try {
      active.domElement.dispatchEvent(new Event('webglcontextlost'))
      expect(images[0].width).toBe(2)
      resourceStorage.deleteTexture(texture.name)
      expect(images[0].width).toBe(0)
      expect(images[0].close).toHaveBeenCalledOnce()
      active.domElement.dispatchEvent(new Event('webglcontextrestored'))
      expect(resourceStorage.getTexture(texture.name)).toBeUndefined()
    } finally {
      release()
    }
  })
  it('keeps final release active after a GPU disposal listener throws', async () => {
    const { texture, images } = await ownedTexture('raster')
    const fail = () => { throw new Error('GPU disposal failed') }
    texture.addEventListener('dispose', fail)
    try {
      expect(() => resourceStorage.invalidateTextureGpuHandles()).toThrow('GPU disposal failed')
      expect(images[0].width).toBe(2)
    } finally {
      texture.removeEventListener('dispose', fail)
    }
    resourceStorage.deleteAllTextures()
    expect(images[0].width).toBe(0)
    expect(images[0].close).toHaveBeenCalledOnce()
  })
  it('keeps a monotonic observed context generation across final release/rebind and ignores unpaired events', () => {
    const active = renderer(),
      owner = { invalidateTextureGpuHandles: vi.fn() }
    let release = bindResourceStorageContext(active, owner)
    const emit = (type: string) => active.domElement.dispatchEvent(new Event(type))
    try {
      emit('webglcontextrestored')
      expect(getRendererContextGeneration(active)).toBe(0)
      emit('webglcontextlost')
      emit('webglcontextlost')
      expect(getRendererContextGeneration(active)).toBe(0)
      emit('webglcontextrestored')
      emit('webglcontextrestored')
      expect(getRendererContextGeneration(active)).toBe(1)
      release()
      emit('webglcontextlost')
      emit('webglcontextrestored')
      release = bindResourceStorageContext(active, owner)
      expect(getRendererContextGeneration(active)).toBe(1)
      emit('webglcontextrestored')
      expect(getRendererContextGeneration(active)).toBe(1)
      emit('webglcontextlost')
      emit('webglcontextrestored')
      expect(getRendererContextGeneration(active)).toBe(2)
      expect(owner.invalidateTextureGpuHandles).toHaveBeenCalledTimes(2)
    } finally {
      release()
    }
  })
  it('keeps the Engine-owned binding across scenario disposal and releases it only at final renderer cleanup', () => {
    const active = renderer(),
      texture = new Texture()
    texture.name = 'engine-context'
    resourceStorage.addTexture(texture)
    active.setAnimationLoop = vi.fn()
    const dispose = vi.spyOn(texture, 'dispose'),
      applicationListeners = vi.spyOn(globalThis, 'addEventListener').mockImplementation(() => {})
    const engine = new Engine(
      { dispose: vi.fn() } as never,
      { dispose: vi.fn() } as never,
      null as never,
      { stopFollowing: vi.fn() } as never,
      active,
      { domElement: document.createElement('div') } as never,
      null as never,
      null as never,
      null as never,
      null as never,
      { dispose: vi.fn() } as never,
      null as never
    )
    try {
      engine.dispose()
      active.domElement.dispatchEvent(new Event('webglcontextlost'))
      expect(dispose).toHaveBeenCalledOnce()
      engine.releaseRendererContextBinding()
      active.domElement.dispatchEvent(new Event('webglcontextrestored'))
      active.domElement.dispatchEvent(new Event('webglcontextlost'))
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      engine.releaseRendererContextBinding?.()
      applicationListeners.mockRestore()
    }
  })
  it('invalidates unique GPU handles while preserving CPU/content/residency identities and notifications', () => {
    const close = vi.fn(),
      image = { width: 1, height: 1, close },
      a = new Texture(image as never),
      b = new Texture(image as never)
    a.name = b.name = 'context-source'
    resourceStorage.addTexture(a)
    resourceStorage.addTexture(a)
    resourceStorage.addTexture(b)
    const collection = resourceStorage.textures,
      source = a.source,
      stamp = resourceStorage.getTextureSnapshot(a.name)
    const first = vi.spyOn(a, 'dispose'),
      second = vi.spyOn(b, 'dispose'),
      notifications = vi.fn(),
      stop = resourceStorage.subscribeTextureChanges(notifications)
    try {
      resourceStorage.invalidateTextureGpuHandles()
      expect(first).toHaveBeenCalledOnce()
      expect(second).toHaveBeenCalledOnce()
      expect(resourceStorage.textures).toBe(collection)
      expect(resourceStorage.getCountTextures()).toBe(3)
      expect(resourceStorage.getTexture(a.name)).toBe(a)
      expect(a.source).toBe(source)
      expect(a.image).toBe(image)
      expect(resourceStorage.getTextureSnapshot(a.name)).toEqual(stamp)
      expect(notifications).not.toHaveBeenCalled()
      expect(close).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })
  it('deduplicates leases and loss cycles, keeps one lease alive, and ignores removed/manual queued handlers', () => {
    const active = renderer(),
      invalidateTextureGpuHandles = vi.fn(),
      owner = { invalidateTextureGpuHandles }
    const listen = vi.spyOn(active.domElement, 'addEventListener')
    const a = bindResourceStorageContext(active, owner),
      b = bindResourceStorageContext(active, owner)
    expect(listen.mock.calls.map((call) => call[0])).toEqual(['webglcontextlost', 'webglcontextrestored'])
    const lost = () => active.domElement.dispatchEvent(new Event('webglcontextlost'))
    const restored = () => active.domElement.dispatchEvent(new Event('webglcontextrestored'))
    lost()
    lost()
    expect(invalidateTextureGpuHandles).toHaveBeenCalledOnce()
    restored()
    expect(invalidateTextureGpuHandles).toHaveBeenCalledOnce()
    lost()
    expect(invalidateTextureGpuHandles).toHaveBeenCalledTimes(2)
    a()
    a()
    restored()
    lost()
    expect(invalidateTextureGpuHandles).toHaveBeenCalledTimes(3)
    b()
    restored()
    lost()
    const callback = listen.mock.calls[0][1] as EventListener
    callback(new Event('webglcontextlost'))
    expect(invalidateTextureGpuHandles).toHaveBeenCalledTimes(3)
  })
  it('invalidates once when already lost, including a later rebind, without restoring/uploading eagerly', () => {
    const active = renderer(true),
      owner = { invalidateTextureGpuHandles: vi.fn() }
    const a = bindResourceStorageContext(active, owner),
      b = bindResourceStorageContext(active, owner)
    expect(owner.invalidateTextureGpuHandles).toHaveBeenCalledOnce()
    a()
    b()
    const c = bindResourceStorageContext(active, owner)
    expect(owner.invalidateTextureGpuHandles).toHaveBeenCalledTimes(2)
    c()
  })
  it('preserves normal add/delete semantics while lost and never emits phantom source-content changes', () => {
    const active = renderer(),
      first = new Texture(),
      next = new Texture()
    first.name = 'before-loss'
    next.name = 'during-loss'
    resourceStorage.addTexture(first)
    const changes = vi.fn(),
      stop = resourceStorage.subscribeTextureChanges(changes),
      release = bindResourceStorageContext(active)
    try {
      active.domElement.dispatchEvent(new Event('webglcontextlost'))
      expect(changes).not.toHaveBeenCalled()
      resourceStorage.addTexture(next)
      resourceStorage.deleteTexture(first.name)
      active.domElement.dispatchEvent(new Event('webglcontextrestored'))
      expect(resourceStorage.getTexture(next.name)).toBe(next)
      expect(changes.mock.calls.map((call) => call[0])).toEqual(['during-loss', 'before-loss'])
    } finally {
      stop()
      release()
    }
  })
})
