import { describe, it, expect } from 'vitest'
import {
  Color,
  Data3DTexture,
  DataArrayTexture,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3
} from 'three'
import { bindSceneCloudReceiver } from '@/core/clouds/receivers/SceneCloudReceiver'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { SceneCloudOutput } from '@/core/clouds/takram/SceneCloudBackend'
import type { SurfaceCloudMap } from '@/core/clouds/SceneCloudConfig'
import type { Actor } from '@/core/models/Actor'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { AerialPerspectiveEffect } from '@takram/three-atmosphere'
import { buildSceneCloudShadowGLSL } from '@/core/clouds/receivers/sceneCloudShadowShader'

const map: SurfaceCloudMap = {
  pattern: { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId: 26 } },
  mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0.2 },
  color: { kind: 'constant', srgb: [1, 1, 1] }
}
function fixture() {
  const camera = new PerspectiveCamera(45, 1, 1, 1e8)
  camera.position.set(0, 0, 7e6)
  camera.updateMatrixWorld()
  const frame: CloudFrame = {
    serial: 7,
    actorId: 3,
    deltaSeconds: 0.016,
    camera,
    sceneCamera: camera,
    centerWorld: new Vector3(),
    planetRotation: new Quaternion(),
    datumRadiusMeters: 6371000,
    viewport: new Vector2(32, 32),
    sunDirection: new Vector3(0, 0, 1),
    lightColor: new Color(1, 1, 1),
    lambert: 1
  }
  const output: SceneCloudOutput = {
    frame,
    atmosphereActorId: 4,
    atmosphereGeneration: 1,
    atmosphereBottomRadiusMeters: 6360000,
    historyGeneration: 0,
    overlay: new Texture(),
    stbn: new Data3DTexture(),
    shadow: {
      map: new DataArrayTexture(),
      cascadeCount: 1,
      mapSize: new Vector2(1, 1),
      intervals: [new Vector2(0, 1)],
      matrices: [new Matrix4()],
      inverseMatrices: [new Matrix4()],
      far: 10000,
      topHeight: 20000
    }
  }
  const material = new ShaderMaterial({ vertexShader: 'void main() {}', fragmentShader: 'void main() {}' })
  return { frame, output, material, receiver: bindSceneCloudReceiver(material, 'sphere') }
}
describe('scene cloud receiver endpoints', () => {
  it('snapshots the current far owner lighting without adding independent settings', () => {
    const f = fixture()
    try {
      f.material.defines.USE_SUN_TINT = 1
      f.material.defines.USE_SKY_AMBIENT = 1
      Object.assign(f.material.uniforms, {
        uSunTintStrength: { value: 0.7 },
        uSkyAmbientStrength: { value: 0.6 },
        uAtmoBottomRadius: { value: 6350 },
        uAtmoTopRadius: { value: 6430 },
        uAtmoDatumRadius: { value: 6371 },
        uAtmoSunAngularRadius: { value: 0.004 }
      })
      f.material.uniforms.sceneCloudAmbient.value = 0.21
      f.material.uniforms.sceneCloudAmbientSunRef.value = 0.4
      const snapshot = f.receiver.getLightSettings!()
      expect(snapshot).toEqual({
        ambient: 0.21,
        ambientSunRef: 0.4,
        sunTintEnabled: true,
        skyAmbientEnabled: true,
        sunTintStrength: 0.7,
        skyAmbientStrength: 0.6,
        bottomRadiusKm: 6350,
        topRadiusKm: 6430,
        datumRadiusKm: 6371,
        sunAngularRadius: 0.004
      })
      f.material.uniforms.sceneCloudAmbient.value = 0.32
      f.material.uniforms.uSunTintStrength.value = 0.2
      delete f.material.defines.USE_SUN_TINT
      const changed = f.receiver.getLightSettings!()
      expect(changed.ambient).toBe(0.32)
      expect(changed.sunTintStrength).toBe(0.2)
      expect(changed.sunTintEnabled).toBe(false)
      expect(changed.skyAmbientEnabled).toBe(false)
      expect(snapshot.ambient).toBe(0.21)
      expect(snapshot.sunTintStrength).toBe(0.7)
    } finally {
      f.receiver.dispose()
      f.material.dispose()
    }
  })
  it('reinstalls owned receiver Uniforms after an owner dictionary reset', () => {
    const f = fixture(),
      frameUniform = f.material.uniforms.sceneCloudHasFrame
    f.material.uniforms = { replacement: { value: 42 } }
    f.receiver.setEndpoint(f.frame, null)
    expect(f.material.uniforms.sceneCloudHasFrame).toBe(frameUniform)
    expect(frameUniform.value).toBe(true)
    const near = f.receiver.getEndpointMaterial('near')
    expect(near.uniforms.replacement).toBe(f.material.uniforms.replacement)
    expect(near.uniforms.sceneCloudHasFrame).toBe(frameUniform)
    f.receiver.dispose()
  })
  it('preserves inherited alpha accessors without version churn on unchanged acquisition', () => {
    const f = fixture()
    f.material.alphaTest = 0.37
    f.material.alphaToCoverage = true
    const near = f.receiver.getEndpointMaterial('near')
    expect(near.alphaTest).toBe(0.37)
    expect(near.alphaToCoverage).toBe(true)
    const version = near.version
    expect(f.receiver.getEndpointMaterial('near')).toBe(near)
    expect(near.version).toBe(version)
    f.material.alphaTest = 0.62
    expect(f.receiver.getEndpointMaterial('near').alphaTest).toBe(0.62)
    expect(near.version).toBe(version)
    f.receiver.dispose()
  })
  it('owns stable far and near programs while borrowing live uniforms and textures', () => {
    const f = fixture(),
      source = new Texture()
    f.receiver.setFarMap(map, source)
    const far = f.receiver.getEndpointMaterial('far')
    const near = f.receiver.getEndpointMaterial('near')
    expect(far).toBe(f.material)
    expect(near).not.toBe(far)
    expect(near.uniforms.sceneCloudMap).toBe(far.uniforms.sceneCloudMap)
    const dictionary = near.uniforms
    expect(far.defines.SCENE_CLOUD_FAR_MAP).toBe(1)
    expect(far.defines.SCENE_CLOUD_FAR_COLOR).toBeUndefined()
    expect(near.defines.SCENE_CLOUD_NEAR).toBe(1)
    const version = near.version
    for (let i = 0; i < 3; i++) {
      f.receiver.setEndpoint(f.frame, f.output)
      expect(f.receiver.getEndpointMaterial('near')).toBe(near)
      f.receiver.setEndpoint(f.frame, null)
      expect(f.receiver.getEndpointMaterial('far')).toBe(far)
    }
    expect(near.version).toBe(version)
    far.defines.USE_STREAMED_DETAIL = 1
    far.needsUpdate = true
    expect(f.receiver.getEndpointMaterial('near')).toBe(near)
    expect(near.defines.USE_STREAMED_DETAIL).toBe(1)
    const replacements = { ...far.uniforms, sceneCloudMap: { value: null }, streamed: { value: source } }
    const sourceIdentity = source.source,
      sourceVersion = source.source.version
    far.uniforms = replacements
    f.receiver.setFarMap(map, source)
    expect(replacements.sceneCloudMap.value).toBe(source)
    far.visible = false
    far.depthWrite = false
    far.opacity = 0.3
    const hook = () => {}
    far.onBeforeRender = hook
    const stableVersion = near.version
    expect(f.receiver.getEndpointMaterial('near').uniforms).toBe(dictionary)
    expect(near.uniforms.sceneCloudMap).toBe(replacements.sceneCloudMap)
    expect(near.uniforms.streamed).toBe(replacements.streamed)
    expect(near.visible).toBe(false)
    expect(near.depthWrite).toBe(false)
    expect(near.opacity).toBe(0.3)
    expect(near.onBeforeRender).toBe(hook)
    expect(near.version).toBe(stableVersion + 1)
    const namesVersion = near.version
    f.receiver.getEndpointMaterial('near')
    expect(near.version).toBe(namesVersion)
    expect(source.source).toBe(sourceIdentity)
    expect(source.source.version).toBe(sourceVersion)
    let released = 0,
      borrowed = 0
    near.addEventListener('dispose', () => released++)
    source.addEventListener('dispose', () => borrowed++)
    f.receiver.dispose()
    f.receiver.dispose()
    expect(released).toBe(1)
    expect(borrowed).toBe(0)
    expect(far.uniforms.sceneCloudMap.value).toBeNull()
    expect(() => f.receiver.getEndpointMaterial('near')).toThrow('disposed')
  })
  it('retires a failed near program only at an explicit retry boundary', () => {
    const f = fixture()
    const first = f.receiver.getEndpointMaterial('near')
    const key = first.customProgramCacheKey()
    let disposed = 0
    first.addEventListener('dispose', () => disposed++)
    f.receiver.retryEndpointMaterial()
    expect(disposed).toBe(1)
    const recovered = f.receiver.getEndpointMaterial('near')
    expect(recovered).not.toBe(first)
    expect(recovered.customProgramCacheKey()).not.toBe(key)
    expect(f.receiver.getEndpointMaterial('near')).toBe(recovered)
    expect(f.receiver.getEndpointMaterial('far')).toBe(f.material)
    f.receiver.dispose()
  })
  it('rejects an unknown raw shadow implementation instead of guessing how to add a fade', () => {
    const reference = new AerialPerspectiveEffect()
    try {
      expect(() =>
        buildSceneCloudShadowGLSL(reference.getFragmentShader().replace('distanceToTop <= 0.0', 'distanceToTop < 1.0'))
      ).toThrow(/raw sampler shape changed/)
    } finally {
      reference.dispose()
    }
  })
  it('material owners retire owned receiver fallbacks before material disposal and preserve migration across resets', () => {
    for (const name of ['', 'default.png', 'night.jpg']) {
      const texture = new Texture()
      texture.name = name
      resourceStorage.addTexture(texture)
    }
    const empty = { first: () => undefined, isNotEmpty: () => false }
    const actor = {
      getAttribute: (_key: string, fallback: unknown) => fallback,
      physicalObject: { getAttribute: () => 6371 },
      renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 0, terrainLambert: 1 }) },
      children: { where: () => empty },
      resources: { where: () => empty, first: () => undefined }
    } as unknown as Actor
    for (const material of [new SphereSurfaceMaterial(actor), new TerrainMaterial(actor), new WaterMaterial(actor)]) {
      const events: string[] = []
      material.uniforms.sceneCloudShadowShadowBuffer.value.addEventListener('dispose', () => events.push('receiver'))
      material.addEventListener('dispose', () => events.push('material'))
      material.sceneCloudReceiver.setFarMap(null, null)
      material.resetMaterial()
      material.updateMaterial()
      expect(material.defines.SCENE_CLOUD_RECEIVER).toBe(1)
      expect(material.defines.USE_CLOUD).toBeUndefined()
      expect(material.defines.USE_CLOUD_SHADOW).toBeUndefined()
      expect(material.defines.USE_WATER_CLOUD).toBeUndefined()
      material.dispose()
      expect(events).toEqual(['receiver', 'material'])
    }
  })
  it('binds explicit scalar color maps and safely disables missing authored color resources', () => {
    const f = fixture(),
      source = new Texture(),
      color = new Texture()
    const scalar: SurfaceCloudMap = {
      ...map,
      pattern: {
        kind: 'mask',
        map: { resourceId: 26 },
        decode: { channel: 'g', inputRange: [0.1, 0.8], exponent: 2, invert: true, sampleSpace: 'encoded' }
      },
      color: { kind: 'map', map: { resourceId: 27 }, strength: 0.35 }
    }
    f.receiver.setFarMap(scalar, source)
    expect(f.material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    f.receiver.setFarMap(scalar, source, color)
    expect(f.material.uniforms.sceneCloudFarEnabled.value).toBe(true)
    expect(f.material.uniforms.sceneCloudColorMap.value).toBe(color)
    expect(f.material.uniforms.sceneCloudColorStrength.value).toBe(0.35)
    const same: SurfaceCloudMap = { ...scalar, color: { kind: 'map', map: { resourceId: 26 }, strength: 1 } }
    f.receiver.setFarMap(same, source)
    expect(f.material.uniforms.sceneCloudColorMap.value).toBe(source)
    f.receiver.setFarMap(map, source, color)
    expect(f.material.uniforms.sceneCloudMappedColor.value).toBe(false)
    expect(f.material.uniforms.sceneCloudEncoding.value).toBe(1)
    f.receiver.dispose()
  })
  it('selects a clean near endpoint when the matching output intentionally has no shadow', () => {
    const f = fixture()
    f.receiver.setFarMap(map, new Texture())
    f.receiver.setEndpoint(f.frame, { ...f.output, shadow: null })
    expect(f.material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    expect(f.material.uniforms.sceneCloudShadowEnabled.value).toBe(false)
    f.receiver.dispose()
  })
  it('keeps original RGB far map independent of backend readiness and returns to far for stale output', () => {
    const f = fixture(),
      source = new Texture()
    f.receiver.setFarMap(map, source)
    f.receiver.setEndpoint(f.frame, null)
    expect(f.material.uniforms.sceneCloudFarEnabled.value).toBe(true)
    expect(f.material.uniforms.sceneCloudMap.value).toBe(source)
    f.receiver.setEndpoint(f.frame, f.output)
    expect(f.material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    expect(f.material.uniforms.sceneCloudShadowEnabled.value).toBe(true)
    for (const changed of [{ serial: 8 }, { actorId: 9 }]) {
      f.receiver.setEndpoint({ ...f.frame, ...changed }, f.output)
      expect(f.material.uniforms.sceneCloudFarEnabled.value).toBe(true)
      expect(f.material.uniforms.sceneCloudShadowEnabled.value).toBe(false)
    }
    f.receiver.dispose()
  })
  it('copies current metre matrices, actual lowered LUT bottom and serial without recompiling each draw', () => {
    const f = fixture()
    f.receiver.setEndpoint(f.frame, f.output)
    const version = f.material.version
    const matrices = f.material.uniforms.sceneCloudShadowShadowMatrices.value
    const intervals = f.material.uniforms.sceneCloudShadowShadowIntervals.value
    const firstMatrix = matrices[0]
    const firstInterval = intervals[0]
    expect(f.material.uniforms.sceneCloudViewToLocal.value.equals(f.frame.camera.matrixWorld)).toBe(true)
    expect(f.material.uniforms.sceneCloudShadowBottomRadius.value).toBe(6360000)
    expect(f.material.uniforms.sceneCloudShadowFrame.value).toBe(7)
    f.output.shadow!.matrices[0].elements[12] = 12
    expect(f.material.uniforms.sceneCloudShadowShadowMatrices.value[0].elements[12]).toBe(0)
    f.receiver.setEndpoint(f.frame, f.output)
    expect(f.material.uniforms.sceneCloudShadowShadowMatrices.value[0].elements[12]).toBe(12)
    expect(f.material.uniforms.sceneCloudShadowShadowMatrices.value).toBe(matrices)
    expect(f.material.uniforms.sceneCloudShadowShadowIntervals.value).toBe(intervals)
    expect(f.material.uniforms.sceneCloudShadowShadowMatrices.value[0]).toBe(firstMatrix)
    expect(f.material.uniforms.sceneCloudShadowShadowIntervals.value[0]).toBe(firstInterval)
    expect(f.material.version).toBe(version)
    f.receiver.dispose()
  })
  it('clears null/off/disposed bindings without disposing borrowed textures', () => {
    const f = fixture(),
      source = new Texture(),
      released: string[] = []
    source.addEventListener('dispose', () => released.push('map'))
    f.output.shadow!.map.addEventListener('dispose', () => released.push('shadow'))
    f.output.stbn.addEventListener('dispose', () => released.push('noise'))
    f.receiver.setFarMap(map, source)
    f.receiver.setEndpoint(f.frame, f.output)
    f.receiver.setEndpoint(null, null)
    expect(f.material.uniforms.sceneCloudShadowEnabled.value).toBe(false)
    f.receiver.setFarMap(null, null)
    expect(f.material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    f.receiver.dispose()
    f.receiver.dispose()
    f.receiver.setFarMap(map, source)
    f.receiver.setEndpoint(f.frame, f.output)
    expect(f.material.uniforms.sceneCloudShadowEnabled.value).toBe(false)
    expect(f.material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    expect(released).toEqual([])
  })
})
