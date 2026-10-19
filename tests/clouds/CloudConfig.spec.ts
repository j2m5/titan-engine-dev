import { expect, it } from 'vitest'
import { resolveCloudConfig } from '@/core/clouds/validateCloudConfig'
import type { CloudPattern } from '@/core/clouds/CloudConfig'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'
import { validCloudConfig } from './cloudFixtures'

const ids = new Set([32, 26, 37])
it('preserves an optional vertical profile bias through validation without changing legacy configs', () => {
  const config = validCloudConfig()
  const detail = { ...config.layers[0].detail, verticalProfileBias: 0.65 }
  const result = resolveCloudConfig({ ...config, layers: [{ ...config.layers[0], detail }] }, ids)
  expect(result).toMatchObject({ state: 'configured', config: { layers: [{ detail }] } })
  expect(resolveCloudConfig(config, ids)).toEqual({ state: 'configured', config })
})
it.each([0, -0.1, 1.01, NaN, Infinity, null, '0.65'])(
  'rejects an invalid vertical profile bias %j at its field',
  (verticalProfileBias) => {
    const config = validCloudConfig()
    const detail = { ...config.layers[0].detail, verticalProfileBias }
    expect(resolveCloudConfig({ ...config, layers: [{ ...config.layers[0], detail }] }, ids)).toMatchObject({
      state: 'invalid',
      issues: [expect.objectContaining({ path: 'layers[0].detail.verticalProfileBias' })]
    })
  }
)
it('accepts RGB cloud masks without scalar decode and rejects unknown encodings', () => {
  const config = validCloudConfig()
  const layer = config.layers[0]
  const pattern = { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 26 } }
  const rgb = { ...config, layers: [{ ...layer, pattern }] }
  expect(resolveCloudConfig(rgb, ids)).toMatchObject({ state: 'configured', config: { layers: [{ pattern }] } })
  expect(resolveCloudConfig(rgb, new Set([32])).state).toBe('invalid')
  expect(
    resolveCloudConfig({ ...rgb, layers: [{ ...layer, pattern: { ...pattern, encoding: 'unknown' } }] }, ids).state
  ).toBe('invalid')
})
it('preserves legacy scalar decode with omitted or explicit scalar encoding', () => {
  const config = validCloudConfig()
  const pattern = {
    kind: 'mask',
    map: { resourceId: 26 },
    decode: { channel: 'g', inputRange: [0.2, 0.9], exponent: 2, invert: true, sampleSpace: 'encoded' }
  }
  for (const encoding of [undefined, 'scalar']) {
    const result = resolveCloudConfig(
      { ...config, layers: [{ ...config.layers[0], pattern: { ...pattern, encoding } }] },
      ids
    )
    expect(result).toMatchObject({ state: 'configured', config: { layers: [{ pattern: { decode: pattern.decode } }] } })
  }
})
it('rejects unknown mask encoding even when its scalar decode is valid', () => {
  const config = validCloudConfig()
  const layer = config.layers[0]
  expect(
    resolveCloudConfig(
      {
        ...config,
        layers: [{ ...layer, pattern: { ...layer.pattern, kind: 'mask', encoding: 'unknown' } }]
      },
      ids
    ).state
  ).toBe('invalid')
})
it('reports the removed far appearance at its field', () => {
  const result = resolveCloudConfig({ ...validCloudConfig(), farAppearance: 'separate-layer' }, ids)
  expect(result.state).toBe('invalid')
  if (result.state !== 'invalid') throw new Error('Expected invalid')
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'farAppearance' })]))
})
it('distinguishes unconfigured, off and configured without consulting resources for inactive modes', () => {
  const unused = {
    has: () => {
      throw new Error('Resource lookup')
    }
  } as unknown as ReadonlySet<number>
  expect(resolveCloudConfig(undefined, unused)).toEqual({ state: 'unconfigured' })
  expect(resolveCloudConfig({ enabled: false }, unused)).toEqual({ state: 'off' })
  expect(resolveCloudConfig(validCloudConfig(), ids).state).toBe('configured')
})
it.each([null, [], {}, { enabled: 1 }, { enabled: 'true' }])('rejects invalid root %j', (value) => {
  expect(resolveCloudConfig(value, ids).state).toBe('invalid')
})
it('returns a checked independent copy without mutating input', () => {
  const config = validCloudConfig()
  const before = structuredClone(config)
  const result = resolveCloudConfig(config, ids)
  expect(config).toEqual(before)
  expect(result.state).toBe('configured')
  if (result.state !== 'configured') throw new Error('Expected configured')
  result.config.layers[0].detail.seed = 1
  expect(config.layers[0].detail.seed).toBe(0x4a757069)
})
it('reports missing actor resources at their fields', () => {
  const result = resolveCloudConfig(validCloudConfig(), new Set())
  if (result.state !== 'invalid') throw new Error('Expected invalid')
  expect(result.issues.map((issue) => issue.path)).toEqual(
    expect.arrayContaining(['layers[0].pattern.map.resourceId', 'layers[0].color.map.resourceId'])
  )
})
const decode = { channel: 'r', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'linear' } as const
const patterns: CloudPattern[] = [
  { kind: 'uniform', coverage: 0 },
  { kind: 'procedural', coverage: 1, scaleMeters: 100, bandStrength: 0.3 },
  { kind: 'mask', map: { resourceId: 26 }, decode: { ...decode, inputRange: [0, 1] } },
  { kind: 'mask', map: { resourceId: 37 }, decode: { ...decode, inputRange: [0, 1] } },
  validCloudConfig().layers[0].pattern
]
it.each(patterns)('accepts pattern $kind and both color/far representations', (pattern) => {
  for (const farAppearance of ['base-texture', 'surface-map'] as const) {
    const config = validCloudConfig()
    config.farAppearance = farAppearance
    config.layers[0].pattern = pattern
    expect(resolveCloudConfig(config, ids).state).toBe('configured')
    config.layers[0].color = { kind: 'constant', srgb: [0, 0.5, 1] }
    expect(resolveCloudConfig(config, ids).state).toBe('configured')
  }
})
const invalidFields: [string, unknown][] = [
  ['layers', []],
  ['mapping', null],
  ['lod', null],
  ['layers.0', null],
  ['layers.0.id', ''],
  ['layers.0.id', '   '],
  ['layers.0.baseAltitudeMeters', -1],
  ['layers.0.thicknessMeters', 0],
  ['layers.0.thicknessMeters', -1],
  ['layers.0.thicknessMeters', NaN],
  ['layers.0.thicknessMeters', Infinity],
  ['layers.0.extinctionPerMeter', 0],
  ['layers.0.pattern', null],
  ['layers.0.color', null],
  ['layers.0.detail', null],
  ['layers.0.detail.seed', 1.5],
  ['layers.0.detail.shapeScaleMeters', 0],
  ['layers.0.detail.erosionScaleMeters', -1],
  ['layers.0.detail.erosionStrength', 2],
  ['layers.0.castsShadow', 1],
  ['layers.0.pattern.kind', 'unknown'],
  ['layers.0.pattern.map', null],
  ['layers.0.pattern.decode', null],
  ['layers.0.pattern.decode.channel', 'unknown'],
  ['layers.0.pattern.decode.sampleSpace', 'unknown'],
  ['layers.0.pattern.decode.invert', 1],
  ['layers.0.pattern.decode.inputRange', [1, 0]],
  ['layers.0.pattern.decode.inputRange', [0, 0]],
  ['layers.0.pattern.decode.inputRange', [0]],
  ['layers.0.pattern.decode.exponent', 0],
  ['layers.0.pattern.coverageRange', [0.9, 0.1]],
  ['layers.0.pattern.coverageRange', [-0.1, 1]],
  ['layers.0.pattern.coverageRange', [0, 1.1]],
  ['layers.0.color.strength', -1],
  ['layers.0.color.kind', 'unknown'],
  ['layers.0.color.map', null],
  ['farAppearance', 'unknown'],
  ['farAppearance', 'separate-layer'],
  ['mapping.frame', 'unknown'],
  ['mapping.projection', 'unknown'],
  ['mapping.longitudeOffsetRadians', NaN],
  ['lod.fullDistanceMeters', -1],
  ['lod.cutoffDistanceMeters', 100000],
  ['lod.cutoffDistanceMeters', Infinity]
]
it.each(invalidFields)('rejects malformed %s with a field path', (field, value) => {
  const config: unknown = validCloudConfig()
  const parts = field.split('.')
  let parent = config as Record<string, unknown>
  for (const key of parts.slice(0, -1)) parent = parent[key] as Record<string, unknown>
  parent[parts[parts.length - 1]] = value
  const result = resolveCloudConfig(config, ids)
  if (result.state !== 'invalid') throw new Error('Expected invalid: ' + field)
  expect(result.issues.length).toBeGreaterThan(0)
  expect(result.issues.every((issue) => issue.path.length > 0 && issue.message.length > 0)).toBe(true)
})
it.each([
  { kind: 'uniform', coverage: 2 },
  { kind: 'procedural', coverage: 0.5, scaleMeters: 0, bandStrength: 1 },
  { kind: 'procedural', coverage: 0.5, scaleMeters: 1, bandStrength: -1 }
])('rejects invalid pattern %j', (pattern) => {
  const config = validCloudConfig()
  expect(resolveCloudConfig({ ...config, layers: [{ ...config.layers[0], pattern }] }, ids).state).toBe('invalid')
})
it.each([{ srgb: [2, 0, 0] }, { srgb: [0, -1, 0] }, { srgb: [0, 0] }, { srgb: [0, NaN, 1] }])(
  'rejects invalid constant RGB $srgb',
  ({ srgb }) => {
    const config = validCloudConfig()
    expect(
      resolveCloudConfig({ ...config, layers: [{ ...config.layers[0], color: { kind: 'constant', srgb } }] }, ids).state
    ).toBe('invalid')
  }
)
it('rejects duplicate ids but accepts multiple distinct layers', () => {
  const config = validCloudConfig()
  config.layers.push(structuredClone(config.layers[0]))
  expect(resolveCloudConfig(config, ids).state).toBe('invalid')
  config.layers[1].id = 'upper'
  expect(resolveCloudConfig(config, ids).state).toBe('configured')
})
it('builds a usable Jupiter profile with fresh nested data', () => {
  const profile = createJupiterCloudProfile()
  expect(resolveCloudConfig(profile, new Set([32])).state).toBe('configured')
  expect(profile).toEqual(validCloudConfig())
  profile.layers[0].detail.seed = 1
  expect(createJupiterCloudProfile().layers[0].detail.seed).toBe(0x4a757069)
})
