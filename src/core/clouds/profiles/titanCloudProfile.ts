import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'
import type { SurfaceCloudMap } from '@/core/clouds/SceneCloudConfig'

export const titanCloudMap: SurfaceCloudMap = {
  pattern: {
    kind: 'mask',
    encoding: 'scalar',
    map: { resourceId: 248 },
    decode: { channel: 'r', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'linear' }
  },
  mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
  color: { kind: 'constant', srgb: [1, 1, 1] }
}

export function createTitanCloudProfile(): EnabledCloudConfig {
  const map = structuredClone(titanCloudMap)
  return {
    enabled: true,
    farAppearance: 'surface-map',
    mapping: map.mapping,
    lod: { fullDistanceMeters: 40000, cutoffDistanceMeters: 120000 },
    layers: [
      {
        id: 'titan-methane',
        // One visual tropospheric envelope; orange aerosol haze stays in the atmosphere.
        baseAltitudeMeters: 12000,
        thicknessMeters: 18000,
        extinctionPerMeter: 0.0007,
        pattern: map.pattern,
        color: map.color,
        detail: {
          seed: 0x54697461,
          shapeScaleMeters: 20000,
          erosionScaleMeters: 1800,
          erosionStrength: 0.5,
          verticalProfileBias: 0.65
        },
        castsShadow: true
      }
    ]
  }
}
