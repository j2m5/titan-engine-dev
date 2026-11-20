import type { CloudsEffect } from '@takram/three-clouds'
import { Matrix4, Quaternion, Uniform } from 'three'

/** The private scene effect uses planet-local world axes (identity world/ECEF
 * transform and no altitude correction). Compose rotation in double precision
 * before uploading, so nearby hits never reconstruct planet-sized GPU positions.
 */
export function bindSceneCloudReprojection(clouds: CloudsEffect) {
  const material = clouds.cloudsPass.currentMaterial
  const shadow = clouds.shadowPass
  const current = new Quaternion(),
    previousCloud = new Quaternion(),
    previousShadow = new Quaternion()
  const delta = new Quaternion(),
    transform = new Matrix4()
  const viewReprojection = new Uniform(new Matrix4())
  const shadowReprojection = new Uniform(
    shadow.currentMaterial.uniforms.reprojectionMatrices.value.map(() => new Matrix4())
  )
  let cloudHistory = false,
    shadowHistory = false,
    disposed = false
  const copyCamera = material.copyCameraSettings
  const copyHistory = material.copyReprojectionMatrix
  const setCloudSize = material.setSize
  const updateShadow = shadow.update
  const setShadowSize = shadow.setSize
  const rotate = (previous: Quaternion): Matrix4 =>
    transform.makeRotationFromQuaternion(delta.copy(current).invert().premultiply(previous).normalize())

  material.copyCameraSettings = function (camera) {
    copyCamera.call(this, camera)
    const u = this.uniforms
    if (!cloudHistory || previousCloud.equals(current)) viewReprojection.value.copy(u.viewReprojectionMatrix.value)
    else
      viewReprojection.value
        .copy(u.reprojectionMatrix.value)
        .multiply(rotate(previousCloud))
        .multiply(u.inverseViewMatrix.value)
  }
  material.copyReprojectionMatrix = function (camera) {
    copyHistory.call(this, camera)
    previousCloud.copy(current)
    cloudHistory = true
  }
  material.setSize = function (...args) {
    setCloudSize.apply(this, args)
    cloudHistory = false
  }
  shadow.update = function (...args) {
    if (this.temporalPass) {
      const matrices = this.currentMaterial.uniforms.reprojectionMatrices.value
      if (shadowHistory) rotate(previousShadow)
      for (let i = 0; i < matrices.length; i++) {
        shadowReprojection.value[i].copy(matrices[i])
        if (shadowHistory) shadowReprojection.value[i].multiply(transform)
      }
    }
    updateShadow.apply(this, args)
    // Commit only after both real draws succeeded; color history has its own clock.
    shadowHistory = this.temporalPass
    if (shadowHistory) previousShadow.copy(current)
  }
  shadow.setSize = function (...args) {
    setShadowSize.apply(this, args)
    shadowHistory = false
  }
  return {
    viewReprojection,
    shadowReprojection,
    setPlanetRotation(rotation: Quaternion): void {
      if (!disposed) current.copy(rotation).normalize()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      material.copyCameraSettings = copyCamera
      material.copyReprojectionMatrix = copyHistory
      material.setSize = setCloudSize
      shadow.update = updateShadow
      shadow.setSize = setShadowSize
    }
  }
}
