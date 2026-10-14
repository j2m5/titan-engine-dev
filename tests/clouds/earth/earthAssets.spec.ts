import { expect, it, vi } from 'vitest'
import { Texture, SRGBColorSpace, NoColorSpace } from 'three'
import { loadEarthTextures } from '@/labs/earth-clouds/earthAssets'
it('loads local assets with their required spaces and owns them once', async () => {
  const sources = Array.from({ length: 4 }, () => new Texture())
  const disposal = sources.map((t) => vi.spyOn(t, 'dispose'))
  let i = 0
  const urls: string[] = []
  const maps = await loadEarthTextures({
    loadAsync: async (url) => {
      urls.push(url)
      return sources[i++]
    }
  })
  expect(urls.map((url) => url.split('/').pop())).toEqual([
    'earth.jpg',
    'earth_clouds.jpg',
    'earth_night.jpg',
    'earth_specular.jpg'
  ])
  expect(sources.map((t) => t.colorSpace)).toEqual([SRGBColorSpace, SRGBColorSpace, SRGBColorSpace, NoColorSpace])
  maps.dispose()
  maps.dispose()
  disposal.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
})
it('waits for every load and disposes successes on any rejection', async () => {
  const sources = Array.from({ length: 3 }, () => new Texture())
  const disposal = sources.map((t) => vi.spyOn(t, 'dispose'))
  let i = 0
  await expect(
    loadEarthTextures({
      loadAsync: async (url) => {
        if (url.includes('earth_clouds')) throw new Error('download failed')
        await Promise.resolve()
        return sources[i++]
      }
    })
  ).rejects.toThrow(/clouds.*earth_clouds.jpg/)
  disposal.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
})
