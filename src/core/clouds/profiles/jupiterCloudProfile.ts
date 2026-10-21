import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'

export function createJupiterCloudProfile(): EnabledCloudConfig {
  return {
    enabled: true,
    farAppearance: 'base-texture',
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    lod: { fullDistanceMeters: 100000, cutoffDistanceMeters: 1000000 },
    layers: [
      {
        id: 'jupiter-main',
        baseAltitudeMeters: 10000,
        thicknessMeters: 20000,
        extinctionPerMeter: 0.0008,
        pattern: {
          kind: 'appearance',
          map: { resourceId: 32 },
          decode: { channel: 'luminance', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'encoded' },
          coverageRange: [0.1, 0.45]
        },
        color: { kind: 'map', map: { resourceId: 32 }, strength: 1 },
        detail: { seed: 0x4a757069, shapeScaleMeters: 120000, erosionScaleMeters: 12000, erosionStrength: 0.4 },
        castsShadow: true
      }
    ]
  }
}
