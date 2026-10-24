import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { shouldResetCloudHistory, type CloudHistoryStamp } from '@/core/clouds/scene/cloudLifecycle'

const next: CloudHistoryStamp = {
  actorId: 7,
  scenarioEpoch: 1,
  sourceGeneration: 1,
  atmosphereGeneration: 1,
  quality: 'medium',
  viewport: [640, 360],
  projection: new Matrix4().identity().elements.slice(),
  cameraPositionMeters: new Vector3(0, 0, 6_441_000),
  cameraRotation: new Quaternion(),
  cutoffDistanceMeters: 142000,
  explicitDiscontinuity: 0
}
describe('cloud history validity', () => {
  it('accepts continuous local translation and ordinary rotation', () => {
    expect(shouldResetCloudHistory(null, next)).toBe(true)
    expect(
      shouldResetCloudHistory(next, {
        ...next,
        cameraPositionMeters: next.cameraPositionMeters.clone().add(new Vector3(1, 0, 0)),
        cameraRotation: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1)
      })
    ).toBe(false)
  })
  it.each(['actorId', 'scenarioEpoch', 'sourceGeneration', 'atmosphereGeneration', 'explicitDiscontinuity'] as const)(
    'resets on %s',
    (key) => {
      expect(shouldResetCloudHistory(next, { ...next, [key]: next[key] + 1 })).toBe(true)
    }
  )
  it('resets quality, projection, physical size and abrupt local motion', () => {
    for (const changed of [
      { quality: 'high' as const },
      { viewport: [1280, 720] as const },
      { projection: new Matrix4().makeScale(2, 1, 1).elements },
      { cameraPositionMeters: next.cameraPositionMeters.clone().add(new Vector3(71001, 0, 0)) },
      { cameraRotation: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2) }
    ])
      expect(shouldResetCloudHistory(next, { ...next, ...changed })).toBe(true)
  })
})
