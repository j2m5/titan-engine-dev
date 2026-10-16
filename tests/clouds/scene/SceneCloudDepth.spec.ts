import { expect, it } from 'vitest'
import { SceneCloudDepth } from '@/core/graphic/clouds/SceneCloudDepth'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { Texture, Vector2 } from 'three'
import type { Actor } from '@/core/models/Actor'
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
  const texture = new Texture(),
    viewport = new Vector2(10, 12)
  const version = water.version
  const depth = water.getSceneCloudDepthMaterial(texture, viewport)
  expect(depth).not.toBe(water)
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
