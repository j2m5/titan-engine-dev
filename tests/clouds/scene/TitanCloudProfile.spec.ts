import { expect, it } from 'vitest'
import { DataTexture, NoColorSpace, RepeatWrapping } from 'three'
import { ActorResource, Resources } from '@storage/database'
import { resolveSceneClouds } from '@/core/clouds/resolveSceneClouds'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { prepareCloudSourceAsync } from '@/core/clouds/appearance/prepareCloudSourceAsync'

it('uses a dedicated linear coverage resource for both Titan cloud endpoints', async () => {
  const available = new Set(ActorResource.filter((row) => row.actorId === 29).map((row) => row.resourceId))
  const descriptor = resolveSceneClouds(29, undefined, available)
  expect(descriptor).toMatchObject({ state: 'configured', qualityProfile: 'terrestrial', issues: [] })
  const config = descriptor.volume!
  expect(config).not.toBeNull()
  const layer = config.layers[0]
  expect(layer.pattern).toMatchObject({ kind: 'mask', encoding: 'scalar' })
  if (layer.pattern.kind !== 'mask') throw new Error('Titan requires a coverage mask')
  const resourceId = layer.pattern.map.resourceId
  expect(resourceId).not.toBe(67) // The surface image is not cloud coverage.
  expect(Resources.find((row) => row.id === resourceId)).toMatchObject({
    resourceType: 'cloud',
    lifecycle: 'streamable',
    path: 'planets/titan/titan_methane_coverage.png',
    colorSpace: NoColorSpace,
    wrapS: RepeatWrapping
  })
  expect(descriptor.far).toEqual({ pattern: layer.pattern, mapping: config.mapping, color: layer.color })

  const source = new DataTexture(new Uint8Array([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]), 3, 1)
  source.colorSpace = NoColorSpace
  const resolve = (id: number) => (id === resourceId ? source : undefined)
  const prepared = prepareCloudSource(config, resolve)
  const asyncPrepared = await prepareCloudSourceAsync(config, resolve, { yield: async () => {} })
  try {
    const weather = prepared.textures.weather.image.data!
    expect([weather[0], weather[4], weather[8]]).toEqual([0, 128, 255])
    expect(asyncPrepared.textures.weather.image.data).toEqual(weather)
    expect(resolveSceneClouds(29, { enabled: false }, available)).toMatchObject({
      state: 'off',
      volume: null,
      far: null
    })
    available.delete(resourceId)
    expect(resolveSceneClouds(29, undefined, available)).toMatchObject({ state: 'invalid', volume: null, far: null })
  } finally {
    prepared.dispose()
    asyncPrepared.dispose()
    source.dispose()
  }
})
