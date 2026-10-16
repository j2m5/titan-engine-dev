import { afterEach, describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { CloudRegistry } from '@/core/services/CloudRegistry'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import type { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { createTestContainer } from '../../helpers/createTestContainer'
import { Tokens } from '@/core/providers/tokens'
afterEach(() => {
  heightFieldStorage.clear()
  resourceStorage.deleteAllTextures()
})
describe('stable body cloud registration', () => {
  it('resolves one cloud registry and runtime through actual application providers', () => {
    const container = createTestContainer()
    expect(container.get(Tokens.RenderableFactory).cloudRegistry).toBe(container.get(Tokens.CloudRegistry))
    expect(container.get(Tokens.Postprocessing).cloudRuntime).toBe(container.get(Tokens.SceneCloudRuntime))
  })
  it('preserves the body entry across terrain/water swaps, detaching before material disposal', () => {
    const actor = Actor.find(7)!,
      registry = new CloudRegistry()
    for (const key of [
      '',
      'default.png',
      'night.jpg',
      actor.resources.where('resourceType', 'diffuse').first()!.getAttribute('path')!
    ]) {
      const texture = new Texture()
      texture.name = key
      texture.image = { width: 4, height: 2 }
      resourceStorage.addTexture(texture)
    }
    const factory = new RenderableFactory(
      { domElement: { width: 1920, height: 1080 } } as never,
      {} as never,
      new AtmosphereRegistry(),
      new DepthVolumeRegistry(),
      undefined,
      undefined,
      undefined,
      null,
      null,
      registry
    )
    const node = factory.make(actor) as DynamicNode
    const entry = registry.entries()[0]
    expect(entry.actorId).toBe(7)
    expect(entry.getSurface()).toBe(node.renderable)
    expect(registry.receivers(7)).toHaveLength(1)
    const previous = registry.receivers(7)[0],
      clear = vi.spyOn(previous, 'setFarMap')
    heightFieldStorage['maps'].set(heightPathOf(actor)!, {
      width: 4,
      height: 2,
      minMeters: 0,
      maxMeters: 1000,
      data: new Uint16Array(8)
    })
    expect(factory.upgradePlanetToTerrain(node)).toBe(true)
    expect(clear).toHaveBeenCalledWith(null, null)
    expect(registry.entries()[0]).toBe(entry)
    expect(entry.getSurface()).toBe(node.renderable)
    expect(registry.receivers(7)).toHaveLength(2)
    expect(registry.receivers(7)).not.toContain(previous)
    node.dispose()
    expect(registry.entries()).toEqual([])
  })
})
