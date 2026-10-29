import { expect, it } from 'vitest'
import { ClampToEdgeWrapping, DataTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import { ActorResource } from '@storage/database'
import { resolveSceneClouds } from '@/core/clouds/resolveSceneClouds'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { prepareCloudSourceAsync } from '@/core/clouds/appearance/prepareCloudSourceAsync'

it.each([
  [6, 22, 'terrestrial'],
  [11, 33, 'giant'],
  [12, 35, 'giant'],
  [13, 37, 'giant'],
  [44, 92, 'giant'],
  [57, 92, 'giant'],
  [63, 95, 'giant'],
  [64, 96, 'giant'],
  [82, 109, 'giant'],
  [88, 113, 'terrestrial'],
  [90, 114, 'giant'],
  [120, 95, 'giant'],
  [130, 96, 'giant']
] as const)('prepares actor %i clouds using its own catalog resources', async (actorId, resourceId, qualityProfile) => {
  // A wrong resource ID or an unsupported pattern must fail before reaching the GPU.
  const available = new Set(ActorResource.filter((row) => row.actorId === actorId).map((row) => row.resourceId))
  const descriptor = resolveSceneClouds(actorId, undefined, available)
  expect(descriptor).toMatchObject({ state: 'configured', qualityProfile, issues: [] })
  expect(descriptor.volume).not.toBeNull()
  const config = descriptor.volume!
  const source = new DataTexture(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1)
  source.colorSpace = SRGBColorSpace
  const resolve = (id: number) => (id === resourceId ? source : undefined)
  const prepared = prepareCloudSource(config, resolve)
  const asyncPrepared = await prepareCloudSourceAsync(config, resolve, { yield: async () => {} })
  try {
    expect(asyncPrepared.textures.weather.image.data).toEqual(prepared.textures.weather.image.data)
    const weather = prepared.textures.weather.image.data
    if (!weather) throw new Error('Prepared cloud coverage is missing')
    expect(weather[4]).toBeGreaterThan(weather[0])
    if (actorId === 13 || actorId === 88) {
      // Authored mask backgrounds stay empty; bright systems become volume.
      expect(weather[0]).toBe(0)
      expect(weather[4]).toBe(255)
      expect(descriptor.far).toEqual({
        pattern: config.layers[0].pattern,
        mapping: config.mapping,
        color: config.layers[0].color
      })
    } else {
      // A dark atmospheric band is still a cloud deck, not a hole down to the surface.
      expect(weather[0]).toBeGreaterThan(0)
      expect(weather[4]).toBeLessThan(255)
      const color = prepared.textures.color
      expect(color instanceof DataTexture ? color.image.data : null).toBe(source.image.data)
      expect(color?.wrapS).toBe(RepeatWrapping)
      // Shared diffuse maps also serve other bodies and must keep their own sampler.
      expect(source.wrapS).toBe(ClampToEdgeWrapping)
      expect(descriptor.far).toBeNull()
      expect(config.farAppearance).toBe('base-texture')
    }
    expect(resolveSceneClouds(actorId, { enabled: false }, available)).toMatchObject({
      state: 'off',
      volume: null,
      far: null
    })
    available.delete(resourceId)
    expect(resolveSceneClouds(actorId, undefined, available)).toMatchObject({
      state: 'invalid',
      volume: null,
      far: null
    })
  } finally {
    prepared.dispose()
    asyncPrepared.dispose()
    source.dispose()
  }
})
