import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'

/** One dense upper deck; the existing diffuse map already depicts the cloud tops. */
export function createVenusCloudProfile(): EnabledCloudConfig {
  return {
    enabled: true,
    farAppearance: 'base-texture',
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    lod: { fullDistanceMeters: 60000, cutoffDistanceMeters: 220000 },
    layers: [
      {
        id: 'venus-main',
        baseAltitudeMeters: 50000,
        thicknessMeters: 20000,
        extinctionPerMeter: 0.0012,
        pattern: {
          kind: 'appearance',
          map: { resourceId: 22 },
          decode: { channel: 'luminance', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'encoded' },
          coverageRange: [0.55, 0.85]
        },
        color: { kind: 'map', map: { resourceId: 22 }, strength: 0.6 },
        detail: {
          seed: 0x56656e75,
          shapeScaleMeters: 80000,
          erosionScaleMeters: 8000,
          erosionStrength: 0.2,
          verticalProfileBias: 0.8
        },
        castsShadow: true
      }
    ]
  }
}
