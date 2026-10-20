import { vi } from 'vitest'
import { Color, PerspectiveCamera, Scene, Texture, Vector2, Vector4, WebGLRenderTarget, type Object3D, type WebGLRenderer } from 'three'
import { drawDepthVolumes, DepthVolumePass } from '@/core/graphic/passes/DepthVolumePass'
import { DepthVolumeResolutionRenderer } from '@/core/graphic/passes/DepthVolumeResolutionRenderer'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { LensFrontPass } from '@/core/graphic/passes/LensFrontPass'
import type { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

function setup(temporalBlend = 0.85, resolutionScale = 0.5, budget?: number) {
  let target: WebGLRenderTarget | null = null, alpha = 0.6
  const color = new Color(0.2, 0.3, 0.4), canvas = new EventTarget()
  const draws: { object: Object3D; target: WebGLRenderTarget | null; phase?: number }[] = []
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.z = 3
  camera.updateMatrixWorld()
  const registry = new DepthVolumeRegistry()
  const volume = new NebulaVolume(mergeNebulaParams({ quality: { temporalBlend, resolutionScale } }), registry)
  const output = new WebGLRenderTarget(80, 80), depth = new Texture()
  const scaled = new DepthVolumeResolutionRenderer(budget)
  const renderer = {
    domElement: canvas, autoClear: true, shadowMap: { autoUpdate: true },
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: (next: WebGLRenderTarget | null) => { target = next },
    getCurrentViewport: (out: Vector4) => out.copy(target?.viewport ?? new Vector4(0, 0, 80, 80)),
    getClearColor: (out: Color) => out.copy(color), getClearAlpha: () => alpha,
    setClearColor: (next: Color | number, opacity = 1) => { color.set(next); alpha = opacity },
    clear: vi.fn(),
    render: vi.fn((object: Object3D) => {
      draws.push({ object, target, phase: object instanceof NebulaVolume ? object.material.uniforms.uTemporalJitter?.value : undefined })
      if (object instanceof NebulaVolume && target) expect(target.textures).not.toContain(object.material.uniforms.uLowResolutionMap.value)
    })
  }
  const gl = renderer as unknown as WebGLRenderer
  const size = new Vector2(80, 80)
  const frame = (volumes = [volume], activeCamera = camera) => {
    draws.length = 0
    activeCamera.updateMatrixWorld()
    drawDepthVolumes(gl, output, activeCamera, volumes, depth, size, scaled)
  }
  const dispose = () => { scaled.dispose(); output.dispose(); depth.dispose(); volume.dispose(); volume.geometry.dispose(); volume.material.dispose() }
  return { renderer, gl, camera, volume, registry, output, scaled, draws, size, frame, dispose, canvas }
}

describe('temporal depth volumes', () => {
  it('is opt-in and sanitizes history weight', () => {
    expect(mergeNebulaParams().quality.temporalBlend).toBe(0)
    for (const value of [NaN, Infinity, -Infinity]) expect(mergeNebulaParams({ quality: { temporalBlend: value } }).quality.temporalBlend).toBe(0)
    expect(mergeNebulaParams({ quality: { temporalBlend: -1 } }).quality.temporalBlend).toBe(0)
    expect(mergeNebulaParams({ quality: { temporalBlend: 1 } }).quality.temporalBlend).toBe(0.95)
  })

  it.each([0.5, 1])('captures, resolves and composites at scale %s; reuses ping-pong targets', scale => {
    const s = setup(0.85, scale)
    try {
      const histories: WebGLRenderTarget[] = []
      for (let i = 0; i < 3; i++) {
        s.frame()
        expect(s.draws).toHaveLength(3)
        expect(s.draws[0].object).toBe(s.volume)
        expect(s.draws[0].target!.textures).toHaveLength(2)
        expect(s.draws[0].phase).toBe(i === 0 ? 0 : i === 1 ? 0.5 : 0.25)
        histories.push(s.draws[1].target!)
        expect(s.draws[1].target!.textures).toHaveLength(2)
        expect(s.draws[2].target).toBe(s.output)
        expect(s.volume.material.uniforms.uTemporalJitter.value).toBe(0)
        expect(s.volume.material.uniforms.uTemporalCapture.value).toBe(0)
        expect(s.volume.material.uniforms.uLowResolutionMap.value).toBeNull()
      }
      expect(histories[0]).not.toBe(histories[1])
      expect(histories[0]).toBe(histories[2])
    } finally { s.dispose() }
  })

  it.each(['disabled', 'budget', 'lod', 'cropped'] as const)('keeps static sampling when %s prevents temporal reuse', reason => {
    const s = setup(reason === 'disabled' ? 0 : 0.85, 0.5, reason === 'budget' ? 0 : undefined)
    if (reason === 'lod') s.volume.material.uniforms.uLodBlend.value = 0.5
    if (reason === 'cropped') s.output.viewport.set(10, 0, 70, 80)
    try {
      for (let i = 0; i < 2; i++) {
        s.frame()
        expect(s.draws).toHaveLength(reason === 'cropped' ? 1 : 2)
        expect(s.draws[0].phase).toBe(0)
      }
    } finally { s.dispose() }
  })

  it.each(['cut', 'rotation', 'projection', 'camera', 'transform', 'density', 'params', 'lod', 'resize', 'context', 'lost', 'empty'] as const)('invalidates history on %s', reason => {
    const s = setup()
    try {
      s.frame()
      s.camera.position.x += 0.01
      s.frame()
      expect(s.draws[0].phase).toBe(0.5)
      let camera = s.camera
      if (reason === 'cut') camera.position.x += 1
      if (reason === 'rotation') camera.rotation.y += 0.3
      if (reason === 'projection') { camera.fov += 1; camera.updateProjectionMatrix() }
      if (reason === 'camera') camera = camera.clone()
      if (reason === 'transform') { s.volume.position.x += 0.01; s.volume.updateMatrixWorld() }
      if (reason === 'density') s.volume.material.setBakedDensityTexture(new Texture())
      if (reason === 'params') s.volume.material.setUniformsFromParams(mergeNebulaParams({ palette: { emissiveIntensity: 0.4 } }))
      if (reason === 'lod') { s.volume.material.uniforms.uLodBlend.value = 0.5; s.frame(); s.volume.material.uniforms.uLodBlend.value = 1 }
      if (reason === 'resize') { s.output.setSize(81, 79); s.size.x = 81; s.size.y = 79 }
      if (reason === 'context') s.canvas.dispatchEvent(new Event('webglcontextrestored'))
      if (reason === 'lost') s.canvas.dispatchEvent(new Event('webglcontextlost'))
      if (reason === 'empty') s.frame([])
      s.frame([s.volume], camera)
      expect(s.draws[0].phase).toBe(0)
    } finally { s.dispose() }
  })

  it.each([1, 2, 3])('restores state and drops history after draw %s fails', failingDraw => {
    const s = setup()
    const original = s.renderer.render.getMockImplementation()!
    try {
      s.frame()
      let call = 0
      s.renderer.render.mockImplementation(object => { original(object); if (++call === failingDraw) throw new Error('temporal draw') })
      expect(() => s.frame()).toThrow('temporal draw')
      expect(s.renderer.autoClear).toBe(true)
      expect(s.renderer.getClearAlpha()).toBe(0.6)
      expect(s.renderer.getRenderTarget()).toBe(s.output)
      expect(s.volume.material.uniforms.uTemporalJitter.value).toBe(0)
      expect(s.volume.material.uniforms.uLowResolutionMap.value).toBeNull()
      s.renderer.render.mockImplementation(original)
      s.frame()
      expect(s.draws[0].phase).toBe(0)
    } finally { s.dispose() }
  })

  it('releases histories when the actual pass becomes empty', () => {
    const s = setup(), pass = new DepthVolumePass(s.camera, s.registry)
    pass.setSize(80, 80)
    try {
      pass.render(s.gl, s.output, null)
      const history = s.draws.find(draw => draw.object !== s.volume && draw.target?.textures.length === 2)!.target!
      const disposed = vi.fn()
      history.addEventListener('dispose', disposed)
      s.volume.visible = false
      pass.render(s.gl, s.output, null)
      expect(disposed).toHaveBeenCalledOnce()
    } finally { pass.dispose(); s.dispose() }
  })

  it('accumulates lens-front volumes and releases history when only ordinary objects remain', () => {
    const s = setup()
    let volumes = [s.volume]
    const sorter = { frontVolumes: () => volumes, frontObjects: () => [new Scene()], hasDepthWriters: () => false, restore: vi.fn() } as unknown as LensFrontSorter
    const pass = new LensFrontPass(new Scene(), s.camera, sorter)
    pass.setSize(80, 80)
    try {
      pass.render(s.gl, s.output, null)
      s.draws.length = 0
      pass.render(s.gl, s.output, null)
      expect(s.draws.find(draw => draw.object === s.volume)!.phase).toBe(0.5)
      const history = s.draws.find(draw => draw.object !== s.volume && draw.target?.textures.length === 2)!.target!
      const disposed = vi.fn()
      history.addEventListener('dispose', disposed)
      volumes = []
      pass.render(s.gl, s.output, null)
      expect(disposed).toHaveBeenCalledOnce()
    } finally { pass.dispose(); s.dispose() }
  })

  it('bounds history memory across volumes and reuses capacity when one leaves', () => {
    const s = setup(0.85, 0.5, 40 * 40 * 32)
    const second = new NebulaVolume(mergeNebulaParams({ quality: { resolutionScale: 0.5, temporalBlend: 0.85 } }))
    try {
      s.frame([s.volume, second])
      expect(s.draws.filter(draw => draw.object === s.volume)).toHaveLength(2)
      expect(s.draws.filter(draw => draw.object === second)).toHaveLength(2)
      expect(s.draws).toHaveLength(5) // only one history resolve fits
      s.frame([second])
      expect(s.draws).toHaveLength(3)
      expect(s.draws[0].phase).toBe(0)
      s.frame([second])
      expect(s.draws[0].phase).toBe(0.5)
    } finally { second.dispose(); second.geometry.dispose(); second.material.dispose(); s.dispose() }
  })
})
