import { Color, PerspectiveCamera, Quaternion, Vector2, Vector3 } from 'three'
import { SpaceScale } from '@/core/constants'
import type { CloudBodyEntry } from '@/core/services/CloudRegistry'

export interface CloudFrame {
  serial: number
  deltaSeconds: number
  actorId: number
  camera: PerspectiveCamera
  sceneCamera: PerspectiveCamera
  centerWorld: Vector3
  planetRotation: Quaternion
  datumRadiusMeters: number
  viewport: Vector2
  sunDirection: Vector3
  lightColor: Color
  lambert: number
}
export function captureCloudFrame(
  body: CloudBodyEntry,
  camera: PerspectiveCamera,
  viewport: Vector2,
  serial: number,
  deltaSeconds: number
): CloudFrame | null {
  const surface = body.getSurface()
  if (!surface || !(body.datumRadiusMeters > 0) || viewport.x <= 0 || viewport.y <= 0) return null
  body.object.updateWorldMatrix(true, false)
  surface.updateWorldMatrix(true, false)
  camera.updateWorldMatrix(true, false)
  const centerWorld = body.object.getWorldPosition(new Vector3())
  const local = camera.clone(false)
  local.matrixAutoUpdate = true
  local.position
    .copy(camera.getWorldPosition(new Vector3()))
    .sub(centerWorld)
    .multiplyScalar(1000 / SpaceScale)
  camera.getWorldQuaternion(local.quaternion)
  local.scale.set(1, 1, 1)
  local.near = (camera.near * 1000) / SpaceScale
  local.far = (camera.far * 1000) / SpaceScale
  local.updateProjectionMatrix()
  local.updateMatrixWorld(true)
  return {
    serial,
    deltaSeconds,
    actorId: body.actorId,
    camera: local,
    sceneCamera: camera,
    centerWorld,
    planetRotation: surface.getWorldQuaternion(new Quaternion()),
    datumRadiusMeters: body.datumRadiusMeters,
    viewport: viewport.clone(),
    sunDirection: centerWorld.clone().negate().normalize(),
    lightColor: body.lightColor.clone(),
    lambert: body.lambert
  }
}
export function cloudLayerAltitude(datumMeters: number, bottomMeters: number, baseMeters: number): number {
  return datumMeters - bottomMeters + baseMeters
}
export function decodeSceneCloudDepth(
  depth: number,
  sceneLogFarFactor: number,
  sceneUnitsToMeters: number,
  forwardCosine: number
): number {
  if (
    !Number.isFinite(depth) ||
    depth < 0 ||
    depth >= 1 ||
    !Number.isFinite(sceneLogFarFactor) ||
    sceneLogFarFactor <= 0 ||
    !Number.isFinite(sceneUnitsToMeters) ||
    sceneUnitsToMeters <= 0 ||
    !Number.isFinite(forwardCosine) ||
    forwardCosine <= 0
  )
    return Infinity
  return ((2 ** (depth * sceneLogFarFactor) - 1) * sceneUnitsToMeters) / forwardCosine
}
