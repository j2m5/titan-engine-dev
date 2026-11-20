import { afterEach, expect, it } from 'vitest'
import {
  Color, Data3DTexture, DataArrayTexture, Matrix4, Mesh, PerspectiveCamera, Quaternion,
  Scene, ShaderMaterial, Texture, Uniform, Vector2, Vector3
} from 'three'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import type { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { CloudRegistry } from '@/core/services/CloudRegistry'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { TerrainBoulderMaterial } from '@/core/materials/TerrainBoulderMaterial'
import { withSceneCloudMaterials } from '@/core/graphic/clouds/sceneCloudMaterialScope'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { SceneCloudOutput } from '@/core/clouds/takram/SceneCloudBackend'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  heightFieldStorage.clear()
  resourceStorage.deleteAllTextures()
})

function setup() {
  const actor = Actor.find(7)!, registry = new CloudRegistry()
  for (const path of ['', 'default.png', 'night.jpg', 'star.png', actor.resources.where('resourceType', 'diffuse').first()!.getAttribute('path')!]) {
    const texture = new Texture({ width: 4, height: 2 })
    texture.name = path
    resourceStorage.addTexture(texture)
  }
  const factory = new RenderableFactory(
    { domElement: { width: 1920, height: 1080 }, extensions: { has: () => false } } as never,
    {} as never, new AtmosphereRegistry(), new DepthVolumeRegistry(), undefined, undefined, undefined, null, null, registry
  )
  const node = factory.make(actor) as DynamicNode
  cleanups.push(() => disposeSceneTree(node))
  heightFieldStorage['maps'].set(heightPathOf(actor)!, {
    width: 4, height: 2, minMeters: 0, maxMeters: 1000, data: new Uint16Array(8)
  })
  expect(factory.upgradePlanetToTerrain(node)).toBe(true)
  const surface = node.renderable as TerrainSphere
  const rocks: Mesh[] = []
  surface.traverse(object => {
    if ((object as Mesh).material instanceof TerrainBoulderMaterial) rocks.push(object as Mesh)
  })
  expect(rocks).toHaveLength(4)
  const base = rocks[0].material as TerrainBoulderMaterial
  const receiver = registry.receivers(7).find(candidate => candidate.getEndpointMaterial('far') === base)
  expect(receiver, 'factory must discover the boulder cloud receiver').toBeDefined()
  const scene = new Scene().add(node)
  const camera = new PerspectiveCamera(45, 1, 1, 1e8)
  camera.position.set(0, 0, 7e6)
  camera.updateMatrixWorld()
  const frame: CloudFrame = {
    serial: 7, actorId: 7, deltaSeconds: 0.016, camera, sceneCamera: camera,
    centerWorld: new Vector3(), planetRotation: new Quaternion(), datumRadiusMeters: 6371000,
    viewport: new Vector2(32, 32), sunDirection: new Vector3(0, 0, 1), lightColor: new Color(1, 1, 1), lambert: 1
  }
  const overlay = new Texture(), stbn = new Data3DTexture(), map = new DataArrayTexture()
  cleanups.push(() => { overlay.dispose(); stbn.dispose(); map.dispose() })
  const output: SceneCloudOutput = {
    frame, atmosphereActorId: 8, atmosphereGeneration: 1, atmosphereBottomRadiusMeters: 6360000,
    historyGeneration: 0, overlay, stbn,
    shadow: { map, cascadeCount: 1, mapSize: new Vector2(1, 1), intervals: [new Vector2(0, 1)],
      matrices: [new Matrix4()], inverseMatrices: [new Matrix4()], far: 10000, topHeight: 20000 }
  }
  for (const registered of registry.receivers(7)) registered.setEndpoint(frame, output)
  return { scene, surface, rocks, base, receiver: receiver!, registry, frame, output }
}

it('routes every boulder instance through near clouds and restores far materials when drawing throws', () => {
  const f = setup()
  const bindings = new Map(f.registry.receivers(7).map(receiver => [receiver.getEndpointMaterial('far'), receiver.getEndpointMaterial('near')]))
  const drawError = new Error('draw failed')
  expect(() => withSceneCloudMaterials(f.scene, bindings, () => {
    for (const rock of f.rocks) {
      const near = rock.material as ShaderMaterial
      expect(near.defines.SCENE_CLOUD_NEAR).toBe(1)
      expect(near.uniforms.sceneCloudShadowEnabled.value).toBe(true)
      expect(near.uniforms.sceneCloudShadowShadowBuffer.value).toBe(f.output.shadow!.map)
    }
    throw drawError
  })).toThrow(drawError)
  for (const rock of f.rocks) expect(rock.material).toBe(f.base)
  expect(f.base.defines.SCENE_CLOUD_NEAR).toBeUndefined()
  for (const receiver of f.registry.receivers(7)) receiver.setEndpoint(f.frame, null)
  expect(f.base.uniforms.sceneCloudShadowEnabled.value).toBe(false)
})

it('shares moving boulder origins, refreshed terrain uniforms and draw hooks with its near endpoint', () => {
  const f = setup()
  f.base.origin.set(11, 22, 33)
  const light = new Uniform(new Color(0.2, 0.3, 0.4))
  f.surface.material.uniforms.uLightColor = light
  let draws = 0
  f.base.onBeforeRender = () => { draws++ }
  const near = f.receiver.getEndpointMaterial('near')
  expect(near.uniforms.uLightColor).toBe(light)
  expect(near.uniforms.uBoulderOrigin.value.toArray()).toEqual([11, 22, 33])
  f.base.origin.set(44, 55, 66)
  expect(near.uniforms.uBoulderOrigin.value.toArray()).toEqual([44, 55, 66])
  near.onBeforeRender({} as never, f.scene, f.frame.camera, f.rocks[0].geometry, f.rocks[0], {} as never)
  expect(draws).toBe(1)
})

it('updates cascade programs and retries without recompiling or replacing the far material', () => {
  const f = setup(), farVersion = f.base.version
  const near = f.receiver.getEndpointMaterial('near', 3)
  expect(near.defines.SCENE_CLOUD_SHADOW_CASCADE_COUNT).toBe(3)
  const version = near.version
  expect(f.receiver.getEndpointMaterial('near', 3)).toBe(near)
  expect(near.version).toBe(version)
  expect(f.receiver.getEndpointMaterial('near', 2)).toBe(near)
  expect(near.defines.SCENE_CLOUD_SHADOW_CASCADE_COUNT).toBe(2)
  expect(near.version).toBeGreaterThan(version)
  const key = near.customProgramCacheKey()
  let disposed = 0
  near.addEventListener('dispose', () => disposed++)
  f.receiver.retryEndpointMaterial()
  const retried = f.receiver.getEndpointMaterial('near', 2)
  expect(disposed).toBe(1)
  expect(retried).not.toBe(near)
  expect(retried.customProgramCacheKey()).not.toBe(key)
  expect(f.receiver.getEndpointMaterial('far')).toBe(f.base)
  expect(f.base.version).toBe(farVersion)
  expect(f.base.defines.SCENE_CLOUD_NEAR).toBeUndefined()
})

it('disposes its own near endpoint without disposing the borrowed terrain receiver', () => {
  const f = setup()
  const near = f.receiver.getEndpointMaterial('near')
  const terrainNear = f.surface.sceneCloudReceiver.getEndpointMaterial('near')
  let ownDisposed = 0, terrainDisposed = 0
  near.addEventListener('dispose', () => ownDisposed++)
  terrainNear.addEventListener('dispose', () => terrainDisposed++)
  f.base.dispose()
  f.base.dispose()
  expect(ownDisposed).toBe(1)
  expect(terrainDisposed).toBe(0)
  expect(f.surface.sceneCloudReceiver.getEndpointMaterial('near')).toBe(terrainNear)
})
