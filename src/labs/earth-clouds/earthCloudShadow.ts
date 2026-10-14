import { DataArrayTexture, Matrix4, Uniform, Vector2, Vector3, type ShaderMaterial } from 'three'
import type { AtmosphereShadow } from '@takram/three-atmosphere'
import type { EarthSurfaceFrame, EarthSurfaceOptions } from './EarthSurfaceMaterial'
export { buildEarthCloudShadowGLSL } from './earthCloudShadowShader'
export interface EarthCloudShadowReceiver {
  updateFrame(frame: EarthSurfaceFrame): void
  bind(shadow: AtmosphereShadow | null): void
  dispose(): void
}
export function bindEarthCloudShadowReceiver(
  material: ShaderMaterial,
  options: EarthSurfaceOptions
): EarthCloudShadowReceiver {
  const neutral = new DataArrayTexture(new Uint8Array(4), 1, 1, 1)
  neutral.needsUpdate = true
  const u = material.uniforms
  const values = {
    Enabled: false,
    ShadowBuffer: neutral,
    StbnTexture: options.stbnTexture,
    ShadowIntervals: [new Vector2(0, 1)],
    ShadowMatrices: [new Matrix4()],
    InverseShadowMatrices: [new Matrix4()],
    ShadowFar: 1,
    ShadowTopHeight: 0,
    ShadowRadius: 2,
    CameraNear: 1,
    BottomRadius: options.radiusMeters,
    ProjectionMatrix: new Matrix4(),
    ViewMatrix: new Matrix4(),
    Resolution: new Vector2(1, 1),
    SunDirection: new Vector3(0, 0, 1),
    Frame: 0
  }
  for (const [key, value] of Object.entries(values)) u['earthShadow' + key] = new Uniform(value)
  u.earthWorldToECEF = new Uniform(new Matrix4())
  material.defines.EARTH_SHADOW_CASCADE_COUNT = 1
  let current: AtmosphereShadow | null = null,
    disposed = false
  function refresh() {
    const count = current?.cascadeCount ?? 1
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Earth shadow cascade count must be 1..4')
    if (material.defines.EARTH_SHADOW_CASCADE_COUNT !== count) {
      material.defines.EARTH_SHADOW_CASCADE_COUNT = count
      material.needsUpdate = true
    }
    u.earthShadowEnabled.value = current !== null
    u.earthShadowShadowBuffer.value = current?.map ?? neutral
    u.earthShadowShadowIntervals.value = current?.intervals ?? values.ShadowIntervals
    u.earthShadowShadowMatrices.value = current?.matrices ?? values.ShadowMatrices
    u.earthShadowInverseShadowMatrices.value = current?.inverseMatrices ?? values.InverseShadowMatrices
    u.earthShadowShadowFar.value = current?.far ?? 1
    u.earthShadowShadowTopHeight.value = current?.topHeight ?? 0
  }
  return {
    bind(shadow) {
      current = shadow
      refresh()
    },
    updateFrame(frame) {
      refresh()
      u.earthWorldToECEF.value.copy(frame.worldToECEFMatrix)
      u.earthShadowProjectionMatrix.value.copy(frame.camera.projectionMatrix)
      u.earthShadowViewMatrix.value.copy(frame.camera.matrixWorldInverse)
      u.earthShadowCameraNear.value = frame.camera.near
      u.earthShadowSunDirection.value.copy(frame.sunDirection).normalize()
      u.earthShadowResolution.value.copy(frame.resolution)
      u.earthShadowFrame.value = frame.frame
    },
    dispose() {
      if (disposed) return
      disposed = true
      current = null
      refresh()
      neutral.dispose()
    }
  }
}
