import type { EnabledCloudConfig } from '@/core/clouds/CloudConfig'

export function createKorribanCloudProfile(): EnabledCloudConfig {
  return {
    enabled: true,
    farAppearance: 'surface-map',
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    lod: { fullDistanceMeters: 55000, cutoffDistanceMeters: 150000 },
    layers: [
      {
        id: 'korriban-main',
        // Clear the authored 23.65 km peaks and their procedural terrain detail.
        baseAltitudeMeters: 26000,
        thicknessMeters: 5000,
        extinctionPerMeter: 0.0025,
        pattern: { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 113 } },
        color: { kind: 'constant', srgb: [1, 1, 1] },
        detail: {
          seed: 0x4b6f7272,
          shapeScaleMeters: 16000,
          erosionScaleMeters: 1600,
          erosionStrength: 0.55,
          verticalProfileBias: 0.65
        },
        castsShadow: true
      }
    ]
  }
}
