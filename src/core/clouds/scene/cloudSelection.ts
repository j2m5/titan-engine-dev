import { Frustum, Matrix4, PerspectiveCamera, Sphere, Vector3 } from 'three'
import { SpaceScale } from '@/core/constants'
import type { CloudBodyEntry } from '@/core/services/CloudRegistry'
import { cloudShellDistance, cloudVolumeOpacity } from '../cloudLod'

export type CloudCandidate = {
  actorId: number
  shellDistanceMeters: number
  containsCamera: boolean
  intersectsFrustum: boolean
  cutoffDistanceMeters: number
}
export function cloudBodyCandidate(body: CloudBodyEntry, camera: PerspectiveCamera): CloudCandidate | null {
  const config = body.descriptor.volume
  if (body.descriptor.state !== 'configured' || !config) return null
  body.object.updateWorldMatrix(true, false)
  camera.updateWorldMatrix(true, false)
  const center = body.object.getWorldPosition(new Vector3())
  const altitude =
    (camera.getWorldPosition(new Vector3()).sub(center).length() * 1000) / SpaceScale - body.datumRadiusMeters
  const distance = cloudShellDistance(altitude, config.layers)
  // Use the shared LOD boundary, including exactly zero opacity at cutoff.
  if (cloudVolumeOpacity(distance, config.lod) <= 0) return null
  const radius =
    body.datumRadiusMeters + Math.max(...config.layers.map((l) => l.baseAltitudeMeters + l.thicknessMeters))
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  )
  return {
    actorId: body.actorId,
    shellDistanceMeters: distance,
    containsCamera: distance === 0,
    intersectsFrustum: frustum.intersectsSphere(new Sphere(center, (radius * SpaceScale) / 1000)),
    cutoffDistanceMeters: config.lod.cutoffDistanceMeters
  }
}
export function selectCloudBody(candidates: readonly CloudCandidate[], currentId: number | null): number | null {
  const eligible = candidates
    .filter(
      (c) =>
        Number.isFinite(c.shellDistanceMeters) &&
        c.shellDistanceMeters >= 0 &&
        Number.isFinite(c.cutoffDistanceMeters) &&
        c.cutoffDistanceMeters > 0 &&
        c.shellDistanceMeters < c.cutoffDistanceMeters &&
        (c.containsCamera || c.intersectsFrustum)
    )
    .sort(
      (a, b) =>
        Number(b.containsCamera) - Number(a.containsCamera) ||
        a.shellDistanceMeters - b.shellDistanceMeters ||
        a.actorId - b.actorId
    )
  const best = eligible[0]
  if (!best) return null
  const current = eligible.find((c) => c.actorId === currentId)
  if (!current || (best.containsCamera && !current.containsCamera)) return best.actorId
  return best.containsCamera === current.containsCamera &&
    current.shellDistanceMeters - best.shellDistanceMeters >= 0.1 * best.cutoffDistanceMeters
    ? best.actorId
    : current.actorId
}
