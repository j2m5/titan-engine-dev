import { Mesh, PerspectiveCamera, Vector2, Vector3, WebGLRenderer } from 'three'
import { Nebula } from '@/core/renderables/Nebula'

const fakeRenderer = {
  getSize: (v: Vector2) => {
    v.set(1920, 1080)
    return v
  },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

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

  it('adds a hidden impostor billboard alongside the volume', () => {
    const nebula = new Nebula(fakeRenderer)
    const meshes = nebula.children.filter((c) => c instanceof Mesh)
    expect(meshes.length).toBe(2)
    // impostor starts hidden; the LOD switch reveals it only when far/small
    const hidden = meshes.filter((m) => m.visible === false)
    expect(hidden.length).toBe(1)
  })

  it('updateObject runs without throwing', () => {
    const nebula = new Nebula(fakeRenderer)
    expect(() =>
      nebula.updateObject({ delta: 0, epoch: 0, elapsed: 0, camera: new PerspectiveCamera() })
    ).not.toThrow()
  })

  it('dispose runs without throwing', () => {
    const nebula = new Nebula(fakeRenderer)
    expect(() => nebula.dispose()).not.toThrow()
  })

  it('bakes a 3D density field when quality.bake3DTexture is set', () => {
    const nebula = new Nebula(fakeRenderer, { quality: { bake3DTexture: true, bakeResolution: 64 } })
    // construction triggers the bake (offscreen, mocked renderer) without throwing
    expect(nebula.params.quality.bake3DTexture).toBe(true)
    expect(() => nebula.dispose()).not.toThrow()
  })
})
