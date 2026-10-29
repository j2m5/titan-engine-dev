import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'

export function createNeptuneCloudProfile(): EnabledCloudConfig {
  return {
    enabled: true,
    farAppearance: 'surface-map',
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    lod: { fullDistanceMeters: 100000, cutoffDistanceMeters: 800000 },
    layers: [
      {
        id: 'neptune-main',
        baseAltitudeMeters: 20000,
        thicknessMeters: 18000,
        extinctionPerMeter: 0.0012,
        pattern: { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 37 } },
        color: { kind: 'constant', srgb: [1, 1, 1] },
        detail: {
          seed: 0x4e657074,
          shapeScaleMeters: 80000,
          erosionScaleMeters: 8000,
          erosionStrength: 0.45,
          verticalProfileBias: 0.6
        },
        castsShadow: true
      }
    ]
  }
}
