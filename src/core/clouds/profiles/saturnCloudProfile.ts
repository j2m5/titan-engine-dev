import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'

export function createSaturnCloudProfile(): EnabledCloudConfig {
  return {
    enabled: true,
    farAppearance: 'base-texture',
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    lod: { fullDistanceMeters: 150000, cutoffDistanceMeters: 1000000 },
    layers: [
      {
        id: 'saturn-main',
        baseAltitudeMeters: 12000,
        thicknessMeters: 18000,
        extinctionPerMeter: 0.0007,
        pattern: {
          kind: 'appearance',
          map: { resourceId: 33 },
          decode: { channel: 'luminance', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'encoded' },
          coverageRange: [0.22, 0.55]
        },
        color: { kind: 'map', map: { resourceId: 33 }, strength: 1 },
        detail: {
          seed: 0x53617475,
          shapeScaleMeters: 180000,
          erosionScaleMeters: 18000,
          erosionStrength: 0.25,
          verticalProfileBias: 0.65
        },
        castsShadow: true
      }
    ]
  }
}
