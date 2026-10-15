import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTexture } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { CloudSources } from '@/core/clouds/CloudSources'

const make = (name = 'scene-cloud-test') => {
  const texture = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1)
  texture.name = name
  return texture
}
afterEach(() => resourceStorage.deleteAllTextures())
describe('cloud source generations', () => {
  it('exposes live stamps without fabricating missing resources', () => {
    expect(resourceStorage.getTextureSnapshot('missing')).toBeUndefined()
    const texture = make()
    resourceStorage.addTexture(texture)
    const first = resourceStorage.getTextureSnapshot(texture.name)!
    expect(first).toMatchObject({ texture, image: texture.image })
    texture.needsUpdate = true
    expect(resourceStorage.getTextureSnapshot(texture.name)!.textureVersion).toBeGreaterThan(first.textureVersion)
    expect(resourceStorage.getTextureSnapshot(texture.name)!.sourceVersion).toBeGreaterThan(first.sourceVersion)
  })
  it('invalidates synchronously before eviction disposes duplicates', () => {
    const textures = [make(), make()]
    textures.forEach((texture) => resourceStorage.addTexture(texture))
    const order: string[] = []
    const stop = resourceStorage.subscribeTextureChanges(() => order.push('invalidate'))
    textures.forEach((texture) => texture.addEventListener('dispose', () => order.push('dispose')))
    resourceStorage.deleteTexture(textures[0].name)
    expect(order).toEqual(['invalidate', 'dispose', 'dispose'])
    stop()
    stop()
    resourceStorage.deleteTexture(textures[0].name)
    expect(order).toHaveLength(3)
  })
  it('notifies every affected bulk key before any destruction', () => {
    const a = make('a'),
      b = make('b')
    resourceStorage.addTexture(a)
    resourceStorage.addTexture(b)
    const order: string[] = []
    const stop = resourceStorage.subscribeTextureChanges((key) => order.push(key))
    a.addEventListener('dispose', () => order.push('dispose-a'))
    b.addEventListener('dispose', () => order.push('dispose-b'))
    resourceStorage.deleteAllTextures()
    expect(order).toEqual(['a', 'b', 'dispose-a', 'dispose-b'])
    stop()
  })
  it('polls silent image/version changes and ignores unrelated resources', () => {
    const texture = make()
    resourceStorage.addTexture(texture)
    const invalidated = vi.fn()
    const sources = new CloudSources(new Map([[26, texture.name]]), invalidated)
    expect(sources.read(26)?.texture).toBe(texture)
    expect(sources.read(99)).toBeUndefined()
    expect(sources.poll()).toBe(false)
    texture.image = { data: new Uint8Array(4), width: 1, height: 1 }
    expect(sources.poll()).toBe(true)
    expect(invalidated).toHaveBeenCalledTimes(1)
    expect(sources.poll()).toBe(false)
    sources.read(26)
    texture.needsUpdate = true
    expect(sources.poll()).toBe(true)
    sources.read(26)
    resourceStorage.addTexture(make('unrelated'))
    expect(invalidated).toHaveBeenCalledTimes(2)
    resourceStorage.deleteTexture(texture.name)
    expect(invalidated).toHaveBeenCalledTimes(3)
    expect(sources.read(26)).toBeUndefined()
    const replacement = make()
    resourceStorage.addTexture(replacement)
    expect(invalidated).toHaveBeenCalledTimes(4)
    expect(sources.read(26)?.texture).toBe(replacement)
    sources.dispose()
    sources.dispose()
    resourceStorage.deleteTexture(texture.name)
    expect(invalidated).toHaveBeenCalledTimes(4)
  })
})
