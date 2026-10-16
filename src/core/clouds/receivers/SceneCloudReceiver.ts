import { AerialPerspectiveEffect } from '@takram/three-atmosphere'
import {
  Color,
  Data3DTexture,
  DataArrayTexture,
  Matrix4,
  RedFormat,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3
} from 'three'
import { SpaceScale } from '@/core/constants'
import type { SurfaceCloudMap } from '@/core/clouds/SceneCloudConfig'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { SceneCloudOutput } from '@/core/clouds/takram/SceneCloudBackend'
import { sceneCloudMapGLSL } from './sceneCloudMapShader'
import { buildSceneCloudShadowGLSL } from './sceneCloudShadowShader'
import { sceneCloudProgramSignature, syncSceneCloudNearMaterial } from './sceneCloudEndpointMaterial'

export interface SceneCloudReceiver {
  getEndpointMaterial(endpoint: 'far' | 'near'): ShaderMaterial
  retryEndpointMaterial(): void
  setFarMap(
    map: SurfaceCloudMap | null,
    source: import('three').Texture | null,
    colorSource?: import('three').Texture | null
  ): void
  setEndpoint(frame: CloudFrame | null, output: SceneCloudOutput | null): void
  dispose(): void
}

let shadowGLSL: string | undefined
function shadowSource(): string {
  if (shadowGLSL === undefined) {
    const reference = new AerialPerspectiveEffect()
    try {
      shadowGLSL = buildSceneCloudShadowGLSL(reference.getFragmentShader())
    } finally {
      reference.dispose()
    }
  }
  return shadowGLSL
}

/** Keep these layout defines when an owner rebuilds its unrelated streaming gates. */
export function sceneCloudReceiverDefines(material: ShaderMaterial): Record<string, unknown> {
  return Object.fromEntries(Object.entries(material.defines).filter(([key]) => key.startsWith('SCENE_CLOUD_')))
}

export function bindSceneCloudReceiver(
  material: ShaderMaterial,
  _kind: 'sphere' | 'terrain' | 'water'
): SceneCloudReceiver {
  const shader = `${sceneCloudMapGLSL}\n${shadowSource()}`
  if (material.fragmentShader.split('void main()').length !== 2)
    throw new Error('Scene cloud receiver requires one fragment main')
  material.fragmentShader = material.fragmentShader.replace('void main()', `${shader}\nvoid main()`)
  const neutral = new DataArrayTexture(new Uint8Array(4), 1, 1, 1)
  const noise = new Data3DTexture(new Uint8Array(1), 1, 1, 1)
  noise.format = RedFormat
  neutral.needsUpdate = noise.needsUpdate = true
  let u = material.uniforms
  const values = {
    sceneCloudFarEnabled: false,
    sceneCloudHasFrame: false,
    sceneCloudMap: null,
    sceneCloudColorMap: null,
    sceneCloudMappedColor: false,
    sceneCloudColorStrength: 0,
    sceneCloudViewToLocal: new Matrix4(),
    sceneCloudLocalToPlanet: new Matrix4(),
    sceneCloudUnitsToMeters: 1000 / SpaceScale,
    sceneCloudDatumRadiusMeters: 1,
    sceneCloudLongitudeOffset: 0,
    sceneCloudCameraMeters: new Vector3(),
    sceneCloudSunDirection: new Vector3(0, 0, 1),
    sceneCloudLightColor: new Color(1, 1, 1),
    sceneCloudColor: new Color(1, 1, 1),
    sceneCloudLambert: material.uniforms.uTerrainLambert?.value ?? 1,
    sceneCloudAmbient: material.uniforms.uTerrainAmbient?.value ?? 0.15,
    sceneCloudAmbientSunRef: material.uniforms.uTerrainAmbientSunRef?.value ?? 0.3,
    sceneCloudEncoding: 0,
    sceneCloudChannel: 0,
    sceneCloudInputRange: new Vector2(0, 1),
    sceneCloudExponent: 1,
    sceneCloudInvert: false,
    sceneCloudEncodedScalar: false,
    sceneCloudShadowEnabled: false,
    sceneCloudShadowShadowBuffer: neutral,
    sceneCloudShadowStbnTexture: noise,
    sceneCloudShadowShadowIntervals: [new Vector2(0, 1)],
    sceneCloudShadowShadowMatrices: [new Matrix4()],
    sceneCloudShadowInverseShadowMatrices: [new Matrix4()],
    sceneCloudShadowShadowFar: 1,
    sceneCloudShadowShadowTopHeight: 0,
    sceneCloudShadowShadowRadius: 2,
    sceneCloudShadowCameraNear: 1,
    sceneCloudShadowBottomRadius: 1,
    sceneCloudShadowProjectionMatrix: new Matrix4(),
    sceneCloudShadowViewMatrix: new Matrix4(),
    sceneCloudShadowResolution: new Vector2(1, 1),
    sceneCloudShadowSunDirection: new Vector3(0, 0, 1),
    sceneCloudShadowFrame: 0
  }
  for (const [name, value] of Object.entries(values)) u[name] = new Uniform(value)
  const receiverUniforms = Object.fromEntries(Object.keys(values).map((name) => [name, u[name]]))
  function currentUniforms() {
    u = material.uniforms
    for (const name of Object.keys(receiverUniforms)) {
      u[name] ??= receiverUniforms[name]
      receiverUniforms[name] = u[name]
    }
  }
  // Static programs keep far-map and near-shadow sampler closures mutually exclusive.
  material.defines.SCENE_CLOUD_SHADOW_CASCADE_COUNT = 1
  let disposed = false,
    far = false,
    near = false
  let nearMaterial: ShaderMaterial | null = null,
    nearSignature = '',
    retryEpoch = 0
  function migrate() {
    if (material.defines.SCENE_CLOUD_RECEIVER !== undefined) return
    material.defines.SCENE_CLOUD_RECEIVER = 1
    delete material.defines.USE_CLOUD
    delete material.defines.USE_CLOUD_SHADOW
    delete material.defines.USE_WATER_CLOUD
    material.needsUpdate = true
  }
  function clearShadow() {
    u.sceneCloudShadowEnabled.value = false
    u.sceneCloudShadowShadowBuffer.value = neutral
    u.sceneCloudShadowStbnTexture.value = noise
  }
  function refreshFar() {
    u.sceneCloudFarEnabled.value = far && !near && !disposed
  }
  return {
    getEndpointMaterial(endpoint) {
      if (disposed) throw new Error('Scene cloud receiver is disposed')
      currentUniforms()
      if (endpoint === 'far') return material
      const signature = sceneCloudProgramSignature(material)
      nearMaterial ??= new ShaderMaterial()
      syncSceneCloudNearMaterial(material, nearMaterial)
      if (retryEpoch) {
        const key = nearMaterial.customProgramCacheKey()
        nearMaterial.customProgramCacheKey = () => `${key};scene-cloud-near-retry-${retryEpoch}`
      }
      if (signature !== nearSignature) {
        nearSignature = signature
        nearMaterial.needsUpdate = true
      }
      return nearMaterial
    },
    retryEndpointMaterial() {
      if (disposed) return
      nearMaterial?.dispose()
      nearMaterial = null
      nearSignature = ''
      retryEpoch++
    },
    setFarMap(map, source, colorSource) {
      if (disposed) return
      currentUniforms()
      migrate()
      const layout = {
        SCENE_CLOUD_FAR_MAP: map ? 1 : undefined,
        SCENE_CLOUD_FAR_COLOR:
          map && map.pattern.encoding !== 'rgb-cloud-map' && map.color.kind === 'map' ? 1 : undefined
      }
      for (const [name, value] of Object.entries(layout))
        if (material.defines[name] !== value) {
          if (value === undefined) delete material.defines[name]
          else material.defines[name] = value
          material.needsUpdate = true
        }
      far = map !== null && source !== null
      u.sceneCloudMap.value = source
      const mappedColor = map?.pattern.encoding !== 'rgb-cloud-map' && map?.color.kind === 'map'
      const color =
        mappedColor && map?.color.kind === 'map'
          ? (colorSource ?? (map.color.map.resourceId === map.pattern.map.resourceId ? source : null))
          : null
      if (mappedColor && !color) far = false
      u.sceneCloudColorMap.value = color
      u.sceneCloudMappedColor.value = mappedColor
      if (map) {
        u.sceneCloudLongitudeOffset.value = map.mapping.longitudeOffsetRadians
        u.sceneCloudEncoding.value = map.pattern.encoding === 'rgb-cloud-map' ? 1 : 0
        if (map.color.kind === 'constant') u.sceneCloudColor.value.setRGB(...map.color.srgb).convertSRGBToLinear()
        if (map.color.kind === 'map') u.sceneCloudColorStrength.value = map.color.strength
        if (map.pattern.encoding !== 'rgb-cloud-map') {
          const d = map.pattern.decode
          u.sceneCloudChannel.value = ['r', 'g', 'b', 'a', 'luminance'].indexOf(d.channel)
          u.sceneCloudInputRange.value.fromArray(d.inputRange)
          u.sceneCloudExponent.value = d.exponent
          u.sceneCloudInvert.value = d.invert
          u.sceneCloudEncodedScalar.value = d.sampleSpace === 'encoded'
        }
      }
      refreshFar()
    },
    setEndpoint(frame, output) {
      if (disposed) return
      currentUniforms()
      migrate()
      clearShadow()
      near = !!(frame && output && frame.serial === output.frame.serial && frame.actorId === output.frame.actorId)
      u.sceneCloudHasFrame.value = frame !== null
      if (frame) {
        u.sceneCloudViewToLocal.value.copy(frame.camera.matrixWorld)
        u.sceneCloudLocalToPlanet.value.makeRotationFromQuaternion(frame.planetRotation).invert()
        u.sceneCloudDatumRadiusMeters.value = frame.datumRadiusMeters
        u.sceneCloudCameraMeters.value.copy(frame.camera.position)
        u.sceneCloudSunDirection.value.copy(frame.sunDirection)
        u.sceneCloudLightColor.value.copy(frame.lightColor)
        u.sceneCloudLambert.value = frame.lambert
      }
      if (near && frame && output?.shadow) {
        const shadow = output.shadow,
          count = shadow.cascadeCount
        if (!Number.isInteger(count) || count < 1 || count > 4)
          throw new Error('Scene cloud cascade count must be 1..4')
        if (material.defines.SCENE_CLOUD_SHADOW_CASCADE_COUNT !== count) {
          material.defines.SCENE_CLOUD_SHADOW_CASCADE_COUNT = count
          material.needsUpdate = true
        }
        u.sceneCloudShadowEnabled.value = true
        u.sceneCloudShadowShadowBuffer.value = shadow.map
        u.sceneCloudShadowStbnTexture.value = output.stbn
        if (u.sceneCloudShadowShadowIntervals.value.length !== count) {
          u.sceneCloudShadowShadowIntervals.value = Array.from({ length: count }, () => new Vector2())
          u.sceneCloudShadowShadowMatrices.value = Array.from({ length: count }, () => new Matrix4())
          u.sceneCloudShadowInverseShadowMatrices.value = Array.from({ length: count }, () => new Matrix4())
        }
        for (let i = 0; i < count; i++) {
          u.sceneCloudShadowShadowIntervals.value[i].copy(shadow.intervals[i])
          u.sceneCloudShadowShadowMatrices.value[i].copy(shadow.matrices[i])
          u.sceneCloudShadowInverseShadowMatrices.value[i].copy(shadow.inverseMatrices[i])
        }
        u.sceneCloudShadowShadowFar.value = shadow.far
        u.sceneCloudShadowShadowTopHeight.value = shadow.topHeight
        u.sceneCloudShadowBottomRadius.value = output.atmosphereBottomRadiusMeters
        u.sceneCloudShadowProjectionMatrix.value.copy(frame.camera.projectionMatrix)
        u.sceneCloudShadowViewMatrix.value.copy(frame.camera.matrixWorldInverse)
        u.sceneCloudShadowCameraNear.value = frame.camera.near
        u.sceneCloudShadowSunDirection.value.copy(frame.sunDirection).normalize()
        u.sceneCloudShadowResolution.value.copy(frame.viewport)
        u.sceneCloudShadowFrame.value = frame.serial
      }
      refreshFar()
    },
    dispose() {
      if (disposed) return
      currentUniforms()
      disposed = true
      near = false
      far = false
      clearShadow()
      refreshFar()
      u.sceneCloudMap.value = null
      u.sceneCloudColorMap.value = null
      u.sceneCloudHasFrame.value = false
      neutral.dispose()
      noise.dispose()
      nearMaterial?.dispose()
      nearMaterial = null
    }
  }
}
