import type { CloudLayerConfig, EnabledCloudConfig } from '@/core/clouds/CloudConfig'
import type { SceneCloudPreset } from '@/core/clouds/SceneCloudConfig'

type GiantCloudProfile = Pick<
  CloudLayerConfig,
  'id' | 'baseAltitudeMeters' | 'thicknessMeters' | 'extinctionPerMeter' | 'detail'
> & {
  actorId: number
  resourceId: number
  coverageRange: [number, number]
  colorStrength: number
  lod: EnabledCloudConfig['lod']
}

// Explicit artistic profiles for the catalog's extrasolar giants. A diffuse map is
// only used as cloud appearance here; its dark bands must not become empty masks.
const profiles: readonly GiantCloudProfile[] = [
  {
    actorId: 44,
    id: 'sgr-a-i-main',
    resourceId: 92,
    baseAltitudeMeters: 14000,
    thicknessMeters: 18000,
    extinctionPerMeter: 0.0007,
    coverageRange: [0.25, 0.55],
    colorStrength: 0.8,
    lod: { fullDistanceMeters: 120000, cutoffDistanceMeters: 800000 },
    detail: {
      seed: 0x53677241,
      shapeScaleMeters: 150000,
      erosionScaleMeters: 15000,
      erosionStrength: 0.25,
      verticalProfileBias: 0.65
    }
  },
  {
    actorId: 57,
    id: 'toi-519b-main',
    resourceId: 92,
    baseAltitudeMeters: 10000,
    thicknessMeters: 14000,
    extinctionPerMeter: 0.00085,
    coverageRange: [0.2, 0.55],
    colorStrength: 0.8,
    lod: { fullDistanceMeters: 80000, cutoffDistanceMeters: 500000 },
    detail: {
      seed: 0x544f4935,
      shapeScaleMeters: 80000,
      erosionScaleMeters: 8000,
      erosionStrength: 0.3,
      verticalProfileBias: 0.65
    }
  },
  {
    actorId: 63,
    id: 'ohann-main',
    resourceId: 95,
    baseAltitudeMeters: 12000,
    thicknessMeters: 22000,
    extinctionPerMeter: 0.00075,
    coverageRange: [0.18, 0.5],
    colorStrength: 1,
    lod: { fullDistanceMeters: 150000, cutoffDistanceMeters: 1000000 },
    detail: {
      seed: 0x4f68616e,
      shapeScaleMeters: 180000,
      erosionScaleMeters: 18000,
      erosionStrength: 0.35,
      verticalProfileBias: 0.6
    }
  },
  {
    actorId: 64,
    id: 'adriana-main',
    resourceId: 96,
    baseAltitudeMeters: 10000,
    thicknessMeters: 14000,
    extinctionPerMeter: 0.00065,
    coverageRange: [0.3, 0.55],
    colorStrength: 0.7,
    lod: { fullDistanceMeters: 100000, cutoffDistanceMeters: 700000 },
    detail: {
      seed: 0x41647269,
      shapeScaleMeters: 160000,
      erosionScaleMeters: 18000,
      erosionStrength: 0.2,
      verticalProfileBias: 0.7
    }
  },
  {
    actorId: 82,
    id: 'yavin-prime-main',
    resourceId: 109,
    baseAltitudeMeters: 18000,
    thicknessMeters: 30000,
    extinctionPerMeter: 0.0006,
    coverageRange: [0.2, 0.55],
    colorStrength: 1,
    lod: { fullDistanceMeters: 180000, cutoffDistanceMeters: 1200000 },
    detail: {
      seed: 0x59617669,
      shapeScaleMeters: 240000,
      erosionScaleMeters: 24000,
      erosionStrength: 0.3,
      verticalProfileBias: 0.65
    }
  },
  {
    actorId: 90,
    id: 'darkness-main',
    resourceId: 114,
    baseAltitudeMeters: 8000,
    thicknessMeters: 12000,
    extinctionPerMeter: 0.0007,
    coverageRange: [0.3, 0.55],
    colorStrength: 0.7,
    lod: { fullDistanceMeters: 80000, cutoffDistanceMeters: 600000 },
    detail: {
      seed: 0x4461726b,
      shapeScaleMeters: 100000,
      erosionScaleMeters: 12000,
      erosionStrength: 0.2,
      verticalProfileBias: 0.7
    }
  },
  {
    actorId: 120,
    id: 'halcyra-main',
    resourceId: 95,
    baseAltitudeMeters: 12000,
    thicknessMeters: 20000,
    extinctionPerMeter: 0.0007,
    coverageRange: [0.2, 0.5],
    colorStrength: 1,
    lod: { fullDistanceMeters: 130000, cutoffDistanceMeters: 900000 },
    detail: {
      seed: 0x48616c63,
      shapeScaleMeters: 160000,
      erosionScaleMeters: 16000,
      erosionStrength: 0.3,
      verticalProfileBias: 0.65
    }
  },
  {
    actorId: 130,
    id: 'thalorn-main',
    resourceId: 96,
    baseAltitudeMeters: 10000,
    thicknessMeters: 16000,
    extinctionPerMeter: 0.00065,
    coverageRange: [0.28, 0.55],
    colorStrength: 0.75,
    lod: { fullDistanceMeters: 100000, cutoffDistanceMeters: 750000 },
    detail: {
      seed: 0x5468616c,
      shapeScaleMeters: 150000,
      erosionScaleMeters: 18000,
      erosionStrength: 0.2,
      verticalProfileBias: 0.7
    }
  }
]

export function createExtrasolarGiantCloudPresets(): ReadonlyMap<number, SceneCloudPreset> {
  return new Map(
    profiles.map((profile): [number, SceneCloudPreset] => [
      profile.actorId,
      {
        qualityProfile: 'giant',
        far: null,
        volume: {
          enabled: true,
          farAppearance: 'base-texture',
          mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
          lod: { ...profile.lod },
          layers: [
            {
              id: profile.id,
              baseAltitudeMeters: profile.baseAltitudeMeters,
              thicknessMeters: profile.thicknessMeters,
              extinctionPerMeter: profile.extinctionPerMeter,
              pattern: {
                kind: 'appearance',
                map: { resourceId: profile.resourceId },
                decode: {
                  channel: 'luminance',
                  inputRange: [0, 1],
                  exponent: 1,
                  invert: false,
                  sampleSpace: 'encoded'
                },
                coverageRange: [...profile.coverageRange]
              },
              color: { kind: 'map', map: { resourceId: profile.resourceId }, strength: profile.colorStrength },
              detail: { ...profile.detail },
              castsShadow: true
            }
          ]
        }
      }
    ])
  )
}
