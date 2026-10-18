import { Mesh, PerspectiveCamera, Texture, Vector2, Vector3, WebGLRenderer } from 'three'
import { Nebula } from '@/core/renderables/Nebula'
import type { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'

const fakeRenderer = {
  getSize: (v: Vector2) => {
    v.set(1920, 1080)
    return v
  },
  getRenderTarget: () => null,
  getActiveCubeFace: () => 0,
  getActiveMipmapLevel: () => 0,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

// Тесты ниже, где Nebula создаётся без реестра, проверяют автономный режим:
// объём есть в графе, но пасс о нём не знает (тесты, standalone-сцены)

describe('Nebula construction', () => {
  it('builds an Object3D hierarchy containing a volume mesh', () => {
    const nebula = new Nebula(fakeRenderer, { seed: 5, size: 500 })
    expect(nebula.params.seed).toBe(5)
    const meshes = nebula.children.filter((c) => c instanceof Mesh)
    expect(meshes.length).toBeGreaterThanOrEqual(1)
    expect(nebula.children[0].frustumCulled).toBe(false)
  })

  it('scales the proxy uniformly (anisotropy lives in uInvAxis, not the scale)', () => {
    const nebula = new Nebula(fakeRenderer, { size: 500, axisRatios: new Vector3(1, 0.5, 1) })
    const mesh = nebula.children[0]
    expect(mesh.scale.x).toBe(mesh.scale.y)
    expect(mesh.scale.y).toBe(mesh.scale.z)
  })

  it('uses one mesh for both LODs, with a separate bake frame transform', () => {
    const nebula = new Nebula(fakeRenderer)
    const meshes = nebula.children.filter((c) => c instanceof Mesh)
    expect(meshes.length).toBe(1)
    expect(nebula.getObjectByName('NebulaImpostorFrame')).toBeDefined()
    expect((meshes[0] as NebulaVolume).material.uniforms.uLodBlend.value).toBe(1)
  })

  it('updateView runs without throwing', () => {
    const nebula = new Nebula(fakeRenderer)
    expect(() =>
      nebula.updateView(new PerspectiveCamera())
    ).not.toThrow()
  })

  it('dispose runs without throwing', () => {
    const nebula = new Nebula(fakeRenderer)
    expect(() => nebula.dispose()).not.toThrow()
  })

  it('объём лежит на слое DepthVolumePass и числится в реестре до dispose', () => {
    const registry = new DepthVolumeRegistry()
    const nebula = new Nebula(fakeRenderer, {}, registry)
    const volume = nebula.children[0] as NebulaVolume
    // Основной проход камеры (слой 0) объём не видит — его рисует пасс
    expect(volume.layers.mask).toBe(1 << DEPTH_VOLUME_LAYER)
    expect(new PerspectiveCamera().layers.test(volume.layers)).toBe(false)
    expect(registry.volumes()).toEqual([volume])

    nebula.dispose()
    expect(registry.volumes()).toEqual([])
  })

  it('bindSceneDepth/unbindSceneDepth управляют обрезкой марша', () => {
    const nebula = new Nebula(fakeRenderer)
    const volume = nebula.children[0] as NebulaVolume
    const u = volume.material.uniforms
    const texture = new Texture()
    volume.bindSceneDepth(texture, new Vector2(640, 480), 5)
    expect(u.uSceneDepth.value).toBe(texture)
    expect(u.uResolution.value.y).toBe(480)
    expect(u.uLogFarFactor.value).toBe(5)
    expect(u.uSceneDepthEnabled.value).toBe(1)
    volume.unbindSceneDepth()
    expect(u.uSceneDepthEnabled.value).toBe(0)
  })

  it('bakes a 3D density field when quality.bake3DTexture is set', () => {
    // The renderer is spied per test, not shared: the assertions below count
    // calls, and on the shared fake a previous test could satisfy them.
    const render = vi.fn()
    const bakingRenderer = {
      getSize: (v: Vector2) => {
        v.set(1920, 1080)
        return v
      },
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      setRenderTarget: () => {},
      render
    } as unknown as WebGLRenderer

    const bakeResolution = 64
    const nebula = new Nebula(bakingRenderer, { quality: { bake3DTexture: true, bakeResolution } })

    expect(render).not.toHaveBeenCalled()
    const volume = nebula.children[0] as NebulaVolume
    expect(volume.material.uniforms.uDensityTex.value).toBeNull()
    for (let frame = 0; frame < bakeResolution && nebula.bakeQueue.pendingCount; frame++) {
      nebula.bakeQueue.pumpFrame()
    }
    // One render per Z slice; the texture is published only after completion.
    expect(render).toHaveBeenCalledTimes(bakeResolution)
    expect(volume.material.uniforms.uDensityTex.value).not.toBeNull()

    expect(() => nebula.dispose()).not.toThrow()
  })
})
