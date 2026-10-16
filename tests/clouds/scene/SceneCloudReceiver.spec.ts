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
