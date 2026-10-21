import { expect, it } from 'vitest'
import { selectCloudBody, type CloudCandidate } from '@/core/clouds/scene/cloudSelection'
import { cloudBodyCandidate } from '@/core/clouds/scene/cloudSelection'
import { Color, Object3D, PerspectiveCamera } from 'three'
import { SpaceScale } from '@/core/constants'
import type { CloudBodyEntry } from '@/core/services/CloudRegistry'
const candidate = (actorId: number, distance = 0, inside = false): CloudCandidate => ({
  actorId,
  shellDistanceMeters: distance,
  containsCamera: inside,
  intersectsFrustum: true,
  cutoffDistanceMeters: 1000
})
it('selects containing shells even with the disk offscreen', () => {
  expect(selectCloudBody([{ ...candidate(7, 0, true), intersectsFrustum: false }, candidate(10, 10)], 10)).toBe(7)
})
it('uses stable actor IDs for ties independent of registration order', () => {
  expect(selectCloudBody([candidate(10), candidate(7)], null)).toBe(7)
})
it('retains current until exactly ten percent challenger cutoff improvement', () => {
  expect(selectCloudBody([candidate(7, 200), candidate(10, 101)], 7)).toBe(7)
  expect(selectCloudBody([candidate(7, 200), candidate(10, 100)], 7)).toBe(10)
})
it('drops owners outside frustum or cutoff and rejects malformed distances', () => {
  expect(selectCloudBody([{ ...candidate(7), intersectsFrustum: false }, candidate(10)], 7)).toBe(10)
  expect(selectCloudBody([candidate(7, 1000)], 7)).toBe(null)
  expect(selectCloudBody([candidate(7, NaN)], null)).toBe(null)
})
it('measures shell distance from the datum and retains camera containment when looking away', () => {
  const object = new Object3D(),
    datum = 6371000,
    unit = SpaceScale / 1000
  const entry: CloudBodyEntry = {
    actorId: 7,
    object,
    getSurface: () => object,
    datumRadiusMeters: datum,
    lightColor: new Color(),
    lambert: 1,
    resourcePaths: new Map(),
    descriptor: {
      state: 'configured',
      qualityProfile: 'terrestrial',
      far: null,
      issues: [],
      volume: {
        enabled: true,
        farAppearance: 'base-texture',
        mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
        lod: { fullDistanceMeters: 1000, cutoffDistanceMeters: 100000 },
        layers: [
          {
            id: 'one',
            baseAltitudeMeters: 4000,
            thicknessMeters: 4000,
            extinctionPerMeter: 0.01,
            pattern: { kind: 'uniform', coverage: 1 },
            color: { kind: 'constant', srgb: [1, 1, 1] },
            detail: { seed: 0, shapeScaleMeters: 1000, erosionScaleMeters: 100, erosionStrength: 0 },
            castsShadow: true
          }
        ]
      }
    }
  }
  const camera = new PerspectiveCamera(50, 1, 1e-9, 1e9)
  camera.position.z = (datum + 6000) * unit
  camera.lookAt(0, 0, camera.position.z + 1)
  expect(cloudBodyCandidate(entry, camera)?.containsCamera).toBe(true)
  camera.position.z = (datum + 10000) * unit
  const above = cloudBodyCandidate(entry, camera)!
  expect(above.shellDistanceMeters).toBeCloseTo(2000, 6)
  expect(above.intersectsFrustum).toBe(false)
  camera.position.z = (datum + 108000) * unit
  expect(cloudBodyCandidate(entry, camera)).toBe(null)
})
