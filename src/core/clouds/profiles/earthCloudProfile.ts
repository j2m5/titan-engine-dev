import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'

export function createEarthCloudProfile(): EnabledCloudConfig {
  return {
    enabled: true,
    farAppearance: 'surface-map',
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    lod: { fullDistanceMeters: 62000, cutoffDistanceMeters: 142000 },
    layers: [
      {
        id: 'earth-main',
        baseAltitudeMeters: 4000,
        thicknessMeters: 4000,
        extinctionPerMeter: 0.003,
        pattern: {
          kind: 'mask',
          encoding: 'rgb-cloud-map',
          map: { resourceId: 26 }
        },
        color: { kind: 'constant', srgb: [1, 1, 1] },
        detail: {
          seed: 0x45617274,
          shapeScaleMeters: 12000,
          erosionScaleMeters: 1200,
          erosionStrength: 0.65,
          // Move the envelope peak from ~14% to ~34% of the shell height.
          verticalProfileBias: 0.65
        },
        castsShadow: true
      }
    ]
  }
}
