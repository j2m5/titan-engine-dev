import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTexture, PerspectiveCamera, RepeatWrapping, Vector2 } from 'three'
import { Actor } from '@/core/models/Actor'
import { CloudRegistry } from '@/core/services/CloudRegistry'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { resolveSceneClouds } from '@/core/clouds/resolveSceneClouds'
import { Resources, ActorResource } from '@storage/database'

afterEach(() => resourceStorage.deleteAllTextures())
describe('explicit far-only cloud owners', () => {
  it('preserves every authored cloud resource and owner without diffuse inference', () => {
    const clouds = Resources.filter((r) => r.resourceType === 'cloud')
    expect(clouds.map((r) => r.id).sort((a, b) => a - b)).toEqual([26, 37, 113])
    for (const resource of clouds) expect(resource.wrapS, resource.path).toBe(RepeatWrapping)
    expect(
      ActorResource.filter((r) => clouds.some((c) => c.id === r.resourceId)).map((r) => [r.actorId, r.resourceId])
    ).toEqual([
      [7, 26],
      [13, 37],
      [88, 113]
    ])
  })
  it.each([
    [13, 37],
    [88, 113]
  ])('actor %i binds resource %i with no near work at the surface', (actorId, resourceId) => {
    const actor = Actor.find(actorId)!
    const descriptor = resolveSceneClouds(actorId, undefined, new Set([resourceId]))
    expect(descriptor.volume).toBeNull()
    expect(descriptor.far?.pattern.map.resourceId).toBe(resourceId)
    for (const key of [
      '',
      'default.png',
      'night.jpg',
      'star.png',
      ...actor.resources.all().map((r) => r.getAttribute('path')!),
      actor.children.where('categoryId', 6).first()?.resources.first()?.getAttribute('path') ?? ''
    ]) {
      const texture = new DataTexture(new Uint8Array(4), 1, 1)
      texture.name = key
      resourceStorage.addTexture(texture)
    }
    const registry = new CloudRegistry()
    const factory = new RenderableFactory(
      { domElement: { width: 16, height: 8 } } as never,
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
    const node = factory.make(actor)
    expect(registry.entries()).toHaveLength(1)
    const receiver = registry.receivers(actorId)[0]
    const material = receiver.getEndpointMaterial('far')
    const prepare = vi.fn(),
      createBackend = vi.fn()
    const runtime = new SceneCloudRuntime(registry, { prepare, createBackend })
    const camera = new PerspectiveCamera()
    camera.position.z = 0.0001
    camera.updateMatrixWorld()
    const begin = (serial: number) =>
      runtime.beginFrame(camera, new Vector2(16, 8), serial, 0.016, { serial, slots: [], dropped: [] }, false, 0)
    const sourcePath = actor.resources.where('id', resourceId).first()!.getAttribute('path')!
    resourceStorage.deleteTexture(sourcePath)
    begin(0)
    expect(material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    expect(runtime.diagnostics.farFallbacks).toEqual([{ actorId, reason: 'resources' }])
    const snapshot = runtime.diagnostics.farFallbacks as Array<{ actorId: number; reason: 'resources' }>
    snapshot[0].actorId = -1
    snapshot.pop()
    expect(runtime.diagnostics.farFallbacks).toEqual([{ actorId, reason: 'resources' }])
    const source = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
    source.name = actor.resources.where('id', resourceId).first()!.getAttribute('path')!
    resourceStorage.deleteTexture(source.name)
    resourceStorage.addTexture(source)
    expect(begin(1)).toBeNull()
    expect(material.uniforms.sceneCloudMap.value).toBe(source)
    expect(material.uniforms.sceneCloudFarEnabled.value).toBe(true)
    expect(runtime.diagnostics.farFallbacks).toEqual([])
    resourceStorage.deleteTexture(source.name)
    begin(1.5)
    expect(material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    expect(runtime.diagnostics.farFallbacks).toEqual([{ actorId, reason: 'resources' }])
    const replacement = new DataTexture(new Uint8Array([64, 64, 64, 255]), 1, 1)
    replacement.name = source.name
    resourceStorage.deleteTexture(source.name)
    resourceStorage.addTexture(replacement)
    begin(2)
    expect(runtime.diagnostics.farFallbacks).toEqual([])
    expect(material.uniforms.sceneCloudMap.value).toBe(replacement)
    registry.entries()[0].descriptor = resolveSceneClouds(actorId, { enabled: false }, new Set([resourceId]))
    begin(3)
    expect(runtime.diagnostics.farFallbacks).toEqual([])
    expect(material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    registry.entries()[0].descriptor = resolveSceneClouds(actorId, undefined, new Set())
    begin(4)
    expect(material.uniforms.sceneCloudFarEnabled.value).toBe(false)
    expect(registry.entries()[0].descriptor.issues.length).toBeGreaterThan(0)
    expect(prepare).not.toHaveBeenCalled()
    expect(createBackend).not.toHaveBeenCalled()
    expect(runtime.diagnostics.depthPasses).toBe(0)
    expect(runtime.diagnostics.shadowUpdates).toBe(0)
    runtime.dispose()
    ;(node as { dispose?: () => void }).dispose?.()
  })
})
