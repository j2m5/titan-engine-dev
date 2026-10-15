import { expect, it } from 'vitest'
import { resolveSceneClouds } from '@/core/clouds/resolveSceneClouds'
import { validCloudConfig } from '../cloudFixtures'

const ids = new Set([26, 32, 37, 113])
it('honors explicit off before the built-in Earth preset', () => {
  expect(resolveSceneClouds(7, { enabled: false }, ids)).toMatchObject({ state: 'off', volume: null, far: null })
})
it('leaves unknown actors unconfigured', () => {
  expect(resolveSceneClouds(999, undefined, ids)).toMatchObject({ state: 'unconfigured', volume: null, far: null })
})
it.each([
  [7, 26],
  [13, 37],
  [88, 113]
])('resolves checked surface maps for actor %i', (actor, resourceId) => {
  expect(resolveSceneClouds(actor, undefined, ids)).toMatchObject({
    state: 'configured',
    far: { pattern: { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId } } }
  })
})
it('resolves Earth and Jupiter volume presets and far-only Neptune', () => {
  expect(resolveSceneClouds(7, undefined, ids).volume?.layers[0].pattern).toMatchObject({ encoding: 'rgb-cloud-map' })
  expect(resolveSceneClouds(10, undefined, ids)).toMatchObject({
    qualityProfile: 'giant',
    far: null,
    volume: { enabled: true }
  })
  expect(resolveSceneClouds(13, undefined, ids).volume).toBeNull()
})
it('keeps a checked catalog far map but never a preset volume after explicit errors', () => {
  const result = resolveSceneClouds(7, { enabled: true, layers: [] }, ids)
  expect(result).toMatchObject({ state: 'invalid', volume: null, far: { pattern: { map: { resourceId: 26 } } } })
  expect(result.issues.length).toBeGreaterThan(0)
})
it('does not publish unavailable preset maps or volumes', () => {
  for (const actor of [7, 10, 13, 88]) {
    const result = resolveSceneClouds(actor, undefined, new Set())
    expect(result).toMatchObject({ state: 'invalid', volume: null, far: null })
    expect(result.issues.length).toBeGreaterThan(0)
  }
  expect(resolveSceneClouds(7, null, new Set()).far).toBeNull()
})
it('replaces the whole preset with explicit base-texture configuration', () => {
  expect(resolveSceneClouds(7, validCloudConfig(), new Set([32]))).toMatchObject({
    state: 'configured',
    far: null,
    volume: { farAppearance: 'base-texture' }
  })
})
it('derives far only from an unambiguous explicit surface mask', () => {
  const config = validCloudConfig()
  config.farAppearance = 'surface-map'
  config.layers[0].pattern = { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 37 } }
  expect(resolveSceneClouds(7, config, ids).far?.pattern.map.resourceId).toBe(37)
  config.layers.push({ ...structuredClone(config.layers[0]), id: 'upper' })
  expect(resolveSceneClouds(7, config, ids)).toMatchObject({
    state: 'configured',
    far: null,
    volume: { enabled: true }
  })
})
