import { vi } from 'vitest'
import { Color, HalfFloatType, PerspectiveCamera, Scene, Vector4, WebGLRenderTarget, type Object3D, type WebGLRenderer } from 'three'
import { DepthVolumePass } from '@/core/graphic/passes/DepthVolumePass'
import { LensFrontPass } from '@/core/graphic/passes/LensFrontPass'
import type { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

function harness() {
  let target: WebGLRenderTarget | null = null, face = 0, mip = 0, alpha = 0.4
  const color = new Color(0.2, 0.3, 0.4)
  const draws: { object: Object3D; target: WebGLRenderTarget | null; viewport: number[]; depthSize?: number[]; reconstruct?: number; sample: unknown; autoClear: boolean }[] = []
  const clears: { target: WebGLRenderTarget | null; color: Color; alpha: number }[] = []
  const renderer = {
    autoClear: true, shadowMap: { autoUpdate: true },
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    setRenderTarget: vi.fn((next: WebGLRenderTarget | null, layer = 0, level = 0) => { target = next; face = layer; mip = level }),
    getClearColor: (out: Color) => out.copy(color),
    getClearAlpha: () => alpha,
    getCurrentViewport: (out: Vector4) => out.copy(target?.viewport ?? new Vector4(0, 0, 800, 600)),
    setClearColor: (next: Color | number, opacity = 1) => { color.set(next); alpha = opacity },
    clear: vi.fn(() => clears.push({ target, color: color.clone(), alpha })),
    render: vi.fn((object: Object3D) => {
      const u = object instanceof NebulaVolume ? object.material.uniforms : null
      draws.push({ object, target, viewport: target?.viewport.toArray() ?? [0, 0, 800, 600],
        depthSize: u?.uResolution.value.toArray(), reconstruct: u?.uLowResolutionEnabled?.value,
        sample: u?.uLowResolutionMap?.value, autoClear: renderer.autoClear })
    })
  }
  return { renderer: renderer as unknown as WebGLRenderer & Pick<typeof renderer, 'render' | 'clear'>, draws, clears }
}

function setup(scales: number[] = [0.5]) {
  const camera = new PerspectiveCamera(50, 4 / 3, 0.01, 100)
  camera.layers.mask = 0x25
  const registry = new DepthVolumeRegistry()
  const volumes = scales.map(resolutionScale => new NebulaVolume(mergeNebulaParams({ quality: { resolutionScale } }), registry))
  const target = new WebGLRenderTarget(800, 600)
  const pass = new DepthVolumePass(camera, registry)
  pass.setSize(800, 600)
  const mock = harness()
  const dispose = () => {
    pass.dispose()
    target.dispose()
    for (const volume of volumes) { volume.dispose(); volume.geometry.dispose(); volume.material.dispose() }
  }
  return { camera, registry, volumes, target, pass, ...mock, dispose }
}

describe('reduced-resolution depth volumes', () => {
  it('renders a nebula to transparent HDR at half size, then reconstructs over the scene', () => {
    const s = setup()
    try {
      s.pass.render(s.renderer, s.target, null)
      const draws = s.draws.filter(draw => draw.object === s.volumes[0])
      expect(draws).toHaveLength(2)
      expect(draws[0].target).not.toBe(s.target)
      expect(draws[0].target!.texture.type).toBe(HalfFloatType)
      expect(draws[0].target!.depthBuffer).toBe(false)
      expect(draws[0].viewport).toEqual([0, 0, 400, 300])
      expect(draws[0].depthSize).toEqual([400, 300])
      expect(draws[0].sample).toBeNull()
      expect(draws[0].reconstruct).toBe(0)
      expect(draws[1].target).toBe(s.target)
      expect(draws[1].depthSize).toEqual([800, 600])
      expect(draws[1].reconstruct).toBe(1)
      expect(draws[1].sample).toBe(draws[0].target!.texture)
      expect(draws.every(draw => !draw.autoClear)).toBe(true)
      expect(s.clears).toEqual([{ target: draws[0].target, color: new Color(0), alpha: 0 }])
      expect(s.renderer.autoClear).toBe(true)
      expect(s.renderer.getClearColor(new Color())).toEqual(new Color(0.2, 0.3, 0.4))
      expect(s.renderer.getClearAlpha()).toBe(0.4)
      expect(s.camera.layers.mask).toBe(0x25)
      expect(s.renderer.shadowMap.autoUpdate).toBe(true)
      const u = s.volumes[0].material.uniforms
      expect(u.uLowResolutionEnabled.value).toBe(0)
      expect(u.uLowResolutionMap.value).toBeNull()
      expect(u.uSceneDepthEnabled.value).toBe(0)
    } finally { s.dispose() }
  })

  it('shares the largest target across different scales without resizing it per volume', () => {
    const s = setup([0.25, 0.5])
    try {
      s.pass.render(s.renderer, s.target, null)
      const low = s.draws.filter(draw => s.volumes.includes(draw.object as NebulaVolume) && draw.target !== s.target)
      expect(low).toHaveLength(2)
      expect(low[0].target).toBe(low[1].target)
      expect([low[0].target!.width, low[0].target!.height]).toEqual([400, 300])
      expect(low.map(draw => draw.viewport)).toEqual([[0, 0, 200, 150], [0, 0, 400, 300]])
      const disposed = vi.fn()
      low[0].target!.addEventListener('dispose', disposed)
      s.pass.render(s.renderer, s.target, null)
      expect(disposed).not.toHaveBeenCalled()
      s.pass.setSize(321, 201)
      s.target.setSize(321, 201)
      s.pass.render(s.renderer, s.target, null)
      expect(disposed).toHaveBeenCalledOnce()
      expect([low[0].target!.width, low[0].target!.height]).toEqual([161, 101])
      s.pass.dispose()
      expect(disposed).toHaveBeenCalledTimes(2)
    } finally { s.dispose() }
  })

  it.each(['native', 'impostor', 'cropped'] as const)('bypasses reduced rendering for %s draws', mode => {
    const s = setup([mode === 'native' ? 1 : 0.5])
    if (mode === 'impostor') s.volumes[0].material.uniforms.uLodBlend.value = 0
    if (mode === 'cropped') s.target.viewport.set(10, 20, 200, 100)
    try {
      s.pass.render(s.renderer, s.target, null)
      const draws = s.draws.filter(draw => draw.object === s.volumes[0])
      expect(draws).toHaveLength(1)
      expect(draws[0].target).toBe(s.target)
      expect(s.clears).toHaveLength(0)
    } finally { s.dispose() }
  })

  it.each([1, 2])('cleans bindings and renderer state if nebula draw %s fails', failingDraw => {
    const s = setup([0.5, 0.5]), volume = s.volumes[0]
    const render = s.renderer.render.getMockImplementation()!
    let count = 0
    s.renderer.render.mockImplementation((...args) => {
      render(...args)
      if (args[0] === volume && ++count === failingDraw) throw new Error('volume draw')
    })
    try {
      expect(() => s.pass.render(s.renderer, s.target, null)).toThrow('volume draw')
      expect(s.draws.some(draw => draw.object === s.volumes[1])).toBe(false)
      expect(s.renderer.getRenderTarget()).toBe(s.target)
      expect(s.renderer.autoClear).toBe(true)
      expect(s.renderer.getClearAlpha()).toBe(0.4)
      expect(s.camera.layers.mask).toBe(0x25)
      expect(s.renderer.shadowMap.autoUpdate).toBe(true)
      expect(volume.material.uniforms.uLowResolutionEnabled.value).toBe(0)
      expect(volume.material.uniforms.uLowResolutionMap.value).toBeNull()
      expect(volume.material.uniforms.uSceneDepthEnabled.value).toBe(0)
    } finally { s.dispose() }
  })

  it('uses the same reduced-resolution path for volumes in front of a lens', () => {
    const s = setup()
    const sorter = { frontObjects: () => [], frontVolumes: () => s.volumes, restore: vi.fn() } as unknown as LensFrontSorter
    const pass = new LensFrontPass(new Scene(), s.camera, sorter)
    pass.setSize(800, 600)
    try {
      pass.render(s.renderer, s.target, null)
      const draws = s.draws.filter(draw => draw.object === s.volumes[0])
      expect(draws).toHaveLength(2)
      expect(draws[0].depthSize).toEqual([400, 300])
      expect(draws[1].target).toBe(s.target)
      expect(sorter.restore).toHaveBeenCalledOnce()
    } finally { pass.dispose(); s.dispose() }
  })
})
