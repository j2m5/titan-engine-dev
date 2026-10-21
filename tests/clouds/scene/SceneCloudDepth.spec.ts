import { expect, it, vi } from 'vitest'
import { SceneCloudDepth } from '@/core/graphic/clouds/SceneCloudDepth'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { Texture, Vector2, Group, Scene, Mesh, MeshBasicMaterial, PerspectiveCamera, Color, Vector4 } from 'three'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { Actor } from '@/core/models/Actor'
it('visits drawn meshes without assigning read-only material owners on terrain/water groups', () => {
  const scene = new Scene(),
    group = new Group(),
    material = new MeshBasicMaterial()
  Object.defineProperty(group, 'material', { get: () => material })
  group.add(new Mesh(undefined, material))
  scene.add(group)
  const empty = { first: () => undefined, isNotEmpty: () => false }
  const actor = {
    children: { where: () => empty },
    resources: { where: () => empty },
    renderingObject: { getAttribute: () => ({}) }
  } as unknown as Actor
  const water = new WaterMaterial(actor),
    hiddenWater = new WaterMaterial(actor)
  const waterMeshes = [new Mesh(undefined, water), new Mesh(undefined, water)]
  group.add(...waterMeshes)
  const hidden = new Group()
  hidden.visible = false
  hidden.add(new Mesh(undefined, hiddenWater))
  scene.add(hidden)
  const syncWater = vi.spyOn(water, 'getSceneCloudDepthMaterial')
  const syncHidden = vi.spyOn(hiddenWater, 'getSceneCloudDepthMaterial')
  const renderer = {
    autoClear: true,
    capabilities: { maxSamples: 0 },
    getContext: () => ({ getContextAttributes: () => ({ antialias: false }) }),
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getViewport: (value: Vector4) => value.set(0, 0, 8, 8),
    getScissor: (value: Vector4) => value.set(0, 0, 8, 8),
    getScissorTest: () => false,
    getClearColor: (value: Color) => value.set(0),
    getClearAlpha: () => 1,
    setClearColor: () => {},
    setRenderTarget: () => {},
    setViewport: () => {},
    setScissor: () => {},
    setScissorTest: () => {},
    clear: () => {},
    render: () => {}
  }
  const depth = new SceneCloudDepth(renderer as never, scene)
  expect(() =>
    depth.render({ viewport: new Vector2(8, 8), serial: 1, sceneCamera: new PerspectiveCamera() } as CloudFrame)
  ).not.toThrow()
  expect(material.visible).toBe(true)
  expect(material.colorWrite).toBe(true)
  expect(syncWater).toHaveBeenCalledTimes(1)
  expect(syncHidden).not.toHaveBeenCalled()
  for (const mesh of waterMeshes) expect(mesh.material).toBe(water)
  hidden.visible = true
  depth.render({ viewport: new Vector2(8, 8), serial: 2, sceneCamera: new PerspectiveCamera() } as CloudFrame)
  expect(syncWater).toHaveBeenCalledTimes(2)
  expect(syncHidden).toHaveBeenCalledTimes(1)
  depth.dispose()
  material.dispose()
  water.dispose()
  hiddenWater.dispose()
})
it('provides a depth service and cached water variants', () => {
  expect(typeof SceneCloudDepth).toBe('function')
  expect(typeof WaterMaterial.prototype.getSceneCloudDepthMaterial).toBe('function')
})
it('caches a separate depth program while borrowing current uniforms and retaining color state', () => {
  const empty = { first: () => undefined, isNotEmpty: () => false }
  const actor = {
    children: { where: () => empty },
    resources: { where: () => empty },
    renderingObject: { getAttribute: () => ({}) }
  } as unknown as Actor
  const water = new WaterMaterial(actor)
  water.alphaTest = 0.37
  water.alphaToCoverage = true
  const texture = new Texture(),
    viewport = new Vector2(10, 12)
  const version = water.version
  water.uniforms.sceneCloudMap.value = texture
  const borrowedVersion = texture.source.version
  const depth = water.getSceneCloudDepthMaterial(texture, viewport)
  expect(texture.source.version).toBe(borrowedVersion)
  expect(depth).not.toBe(water)
  expect(depth.alphaTest).toBe(0.37)
  expect(depth.alphaToCoverage).toBe(true)
  expect(depth.transparent).toBe(false)
  expect(depth.depthWrite).toBe(true)
  expect(depth.uniforms.uTime).toBe(water.uniforms.uTime)
  expect(depth.uniforms.sceneCloudOpaqueDepth.value).toBe(texture)
  const depthVersion = depth.version
  expect(water.getSceneCloudDepthMaterial(texture, viewport)).toBe(depth)
  expect(depth.version).toBe(depthVersion)
  expect(water.version).toBe(version)
  expect(water.transparent).toBe(true)
  expect(water.depthWrite).toBe(false)
  water.visible = false
  expect(water.getSceneCloudDepthMaterial(texture, viewport).visible).toBe(false)
  water.defines.USE_WATER_DEPTH = 1
  expect(water.getSceneCloudDepthMaterial(texture, viewport).defines.USE_WATER_DEPTH).toBe(1)
  expect(depth.version).toBe(depthVersion + 1)
  water.dispose()
  texture.dispose()
})
