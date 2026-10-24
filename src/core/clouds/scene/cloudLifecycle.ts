import type { Quaternion, Vector3 } from 'three'
import type { CloudQuality } from '../SceneCloudConfig'

export interface CloudHistoryStamp {
  actorId: number
  scenarioEpoch: number
  sourceGeneration: number
  atmosphereGeneration: number
  quality: CloudQuality
  viewport: readonly [number, number]
  projection: readonly number[]
  cameraPositionMeters: Vector3
  cameraRotation: Quaternion
  cutoffDistanceMeters: number
  explicitDiscontinuity: number
}

export function shouldResetCloudHistory(previous: CloudHistoryStamp | null, next: CloudHistoryStamp): boolean {
  if (!previous) return true
  return (
    previous.actorId !== next.actorId ||
    previous.scenarioEpoch !== next.scenarioEpoch ||
    previous.sourceGeneration !== next.sourceGeneration ||
    previous.atmosphereGeneration !== next.atmosphereGeneration ||
    previous.quality !== next.quality ||
    previous.cutoffDistanceMeters !== next.cutoffDistanceMeters ||
    previous.explicitDiscontinuity !== next.explicitDiscontinuity ||
    previous.viewport.some((value, index) => value !== next.viewport[index]) ||
    previous.projection.length !== next.projection.length ||
    previous.projection.some((value, index) => value !== next.projection[index]) ||
    previous.cameraPositionMeters.distanceTo(next.cameraPositionMeters) > next.cutoffDistanceMeters / 2 ||
    previous.cameraRotation.angleTo(next.cameraRotation) > Math.PI / 3
  )
}
