import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'

export function createUranusCloudProfile(): EnabledCloudConfig {
  return {
    enabled: true,
    farAppearance: 'base-texture',
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    lod: { fullDistanceMeters: 80000, cutoffDistanceMeters: 600000 },
    layers: [
      {
        id: 'uranus-main',
        baseAltitudeMeters: 8000,
        thicknessMeters: 12000,
        extinctionPerMeter: 0.0006,
        pattern: {
          kind: 'appearance',
          map: { resourceId: 35 },
          decode: { channel: 'luminance', inputRange: [0, 1], exponent: 1, invert: false, sampleSpace: 'encoded' },
          coverageRange: [0.25, 0.5]
        },
        color: { kind: 'map', map: { resourceId: 35 }, strength: 0.65 },
        detail: {
          seed: 0x5572616e,
          shapeScaleMeters: 150000,
          erosionScaleMeters: 20000,
          erosionStrength: 0.15,
          verticalProfileBias: 0.7
        },
        castsShadow: true
      }
    ]
  }
}
