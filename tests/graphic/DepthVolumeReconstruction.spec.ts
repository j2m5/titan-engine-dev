import { Color, CubeTexture, DataArrayTexture, FloatType, FrontSide, NoBlending, Scene, HalfFloatType, PerspectiveCamera, ShaderMaterial, Texture, Vector2, Vector4, WebGLRenderTarget, type Object3D, type WebGLRenderer } from 'three'
import { vi } from 'vitest'
import { DepthVolumeReconstructionRenderer } from '@/core/graphic/passes/DepthVolumeReconstructionRenderer'
import { DepthVolumeResolutionRenderer } from '@/core/graphic/passes/DepthVolumeResolutionRenderer'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

function setup() {
  const volume = new NebulaVolume(mergeNebulaParams({ quality: { resolutionScale: 0.5 } }))
  const camera = new PerspectiveCamera(50, 4 / 3, .01, 100), resolution = new Vector2(800, 600), depth = new Texture()
  camera.updateMatrixWorld(true); volume.updateMatrixWorld(true)
  const output = new WebGLRenderTarget(800, 600, { type: HalfFloatType, depthBuffer: false })
  const scaled = new DepthVolumeResolutionRenderer()
  let target: WebGLRenderTarget | null = output, face = 0, mip = 0, alpha = .4
  const color = new Color(.2, .3, .4)
  const draws: { object: Object3D; target: WebGLRenderTarget | null; material: ShaderMaterial }[] = []
  const clears: { target: WebGLRenderTarget | null; color: boolean; depth: boolean; stencil: boolean }[] = []
  const clearBufferiv = vi.fn()
  const renderer = {
    autoClear: true, extensions: { has: () => true },
    state: { buffers: { color: { setMask: vi.fn() }, stencil: { setMask: vi.fn() } } },
    getContext: () => ({ getContextAttributes: () => ({ antialias: false, stencil: false }), STENCIL: 6146, clearBufferiv }),
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (next: WebGLRenderTarget | null, layer = 0, level = 0) => { target = next; face = layer; mip = level },
    getClearColor: (out: Color) => out.copy(color), getClearAlpha: () => alpha,
    setClearColor: (next: Color | number, value = 1) => { color.set(next); alpha = value },
    getCurrentViewport: (out: Vector4) => out.copy(target?.viewport ?? new Vector4(0, 0, 800, 600)),
    getScissorTest: () => false,
    clear: (color = true, depth = true, stencil = true) => clears.push({ target, color, depth, stencil }),
    render: (object: Object3D) => draws.push({ object, target, material: (object as NebulaVolume).material })
  }
  const render = () => {
    scaled.prepare([volume], resolution)
    volume.bindSceneDepth(depth, resolution, Math.log2(101))
    scaled.render(renderer as unknown as WebGLRenderer, output, camera, volume, depth, resolution, Math.log2(101))
  }
  const dispose = () => { scaled.dispose(); volume.dispose(); volume.geometry.dispose(); volume.material.dispose(); output.dispose(); depth.dispose() }
  return { volume, camera, resolution, depth, output, scaled, renderer, draws, clears, render, dispose }
}

describe('stencil-gated depth-volume reconstruction', () => {
  it('keeps the low march, excludes reconstructed fragments before fallback and composites once through a separate full-float target', () => {
    const s = setup(), original = s.volume.material
    try {
      s.render()
      expect(s.draws).toHaveLength(4)
      const [low, matched, fallback, composite] = s.draws
      expect(low.object).toBe(s.volume)
      expect(low.target!.texture.type).toBe(HalfFloatType)
      expect(matched.target).not.toBe(s.output)
      expect(matched.target!.texture.type).toBe(FloatType)
      expect(matched.target!.stencilBuffer).toBe(true)
      expect([matched.target!.width, matched.target!.height]).toEqual([800, 600])
      expect(fallback.target).toBe(matched.target)
      expect(matched.material.stencilWrite).toBe(true)
      expect(fallback.material.stencilWriteMask).toBe(0)
      expect(composite.target).toBe(s.output)
      expect(composite.material.uniforms.map.value).toBe(matched.target!.texture)
      expect(s.volume.material).toBe(original)
      expect(s.renderer.getRenderTarget()).toBe(s.output)
      expect(s.renderer.getClearColor(new Color())).toEqual(new Color(.2, .3, .4))
      expect(s.renderer.getClearAlpha()).toBe(.4)
      expect(s.renderer.autoClear).toBe(true)
      expect(s.volume.material.uniforms.uLowResolutionMap.value).toBeNull()
      expect(s.output.stencilBuffer).toBe(false)
      // Clear an explicit zero without changing/depending on the caller's clearStencil value.
      expect(s.renderer.getContext().clearBufferiv).toHaveBeenCalledWith(6146, 0, new Int32Array([0]))
    } finally { s.dispose() }
  })

  it.each(['float', 'msaa', 'stencil', 'scissor', 'viewport', 'mrt', 'cube', 'array', 'budget', 'blend', 'depthTest', 'depthWrite', 'stencilWrite', 'wireframe', 'side', 'invisibleMaterial', 'alphaToCoverage'] as const)('retains combined reconstruction for unsupported %s conditions', mode => {
    const s = setup()
    try {
      if (mode === 'float') s.renderer.extensions.has = () => false
      if (mode === 'msaa') { s.output.samples = 4; s.camera.position.z = 6; s.camera.updateMatrixWorld(true) }
      if (mode === 'stencil') s.output.stencilBuffer = true
      if (mode === 'scissor') s.output.scissorTest = true
      if (mode === 'viewport') s.output.viewport.set(10, 20, 100, 200)
      if (mode === 'mrt') s.output.textures.push(new Texture())
      if (mode === 'cube') s.output.texture = new CubeTexture()
      if (mode === 'array') s.output.texture = new DataArrayTexture()
      if (mode === 'budget') { s.output.setSize(4000, 4000); s.resolution.set(4000, 4000) }
      if (mode === 'blend') s.volume.material.blending = NoBlending
      if (mode === 'depthTest' || mode === 'depthWrite' || mode === 'stencilWrite' || mode === 'wireframe') s.volume.material[mode] = true
      if (mode === 'side') s.volume.material.side = FrontSide
      if (mode === 'invisibleMaterial') s.volume.material.visible = false
      if (mode === 'alphaToCoverage') { s.output.samples = 4; s.volume.material.alphaToCoverage = true }
      s.render()
      expect(s.draws).toHaveLength(mode === 'viewport' ? 1 : 2)
      expect(s.draws.at(-1)!.target).toBe(s.output)
      expect(s.draws.every(draw => draw.object === s.volume)).toBe(true)
    } finally { s.dispose() }
  })

  it('reuses programs/target without cloning source uniforms and refreshes changed source programs', () => {
    const s = setup(), field = new Texture(), disposed = vi.fn(), geometryDisposed = vi.fn(), sourceDisposed = vi.fn()
    field.addEventListener('dispose', disposed); s.volume.geometry.addEventListener('dispose', geometryDisposed); s.volume.material.addEventListener('dispose', sourceDisposed)
    try {
      s.render()
      const matched = s.draws[1].material, fallback = s.draws[2].material, target = s.draws[1].target!, version = matched.version
      expect(matched.uniforms).toBe(s.volume.material.uniforms)
      expect(fallback.uniforms).toBe(s.volume.material.uniforms)
      s.draws.length = 0; s.render()
      expect(s.draws[1].material).toBe(matched)
      expect(s.draws[1].target).toBe(target)
      expect(matched.version).toBe(version)
      s.volume.material.setBakedDensityTexture(field)
      s.draws.length = 0; s.render()
      expect(matched.defines.NEB_BAKED_ONLY).toBe('')
      expect(matched.uniforms.uDensityTex.value).toBe(field)
      expect(matched.version).toBeGreaterThan(version)
      const matchedDisposed = vi.fn(), fallbackDisposed = vi.fn(), targetDisposed = vi.fn()
      matched.addEventListener('dispose', matchedDisposed); fallback.addEventListener('dispose', fallbackDisposed); target.addEventListener('dispose', targetDisposed)
      s.scaled.prepare([], s.resolution)
      expect(matchedDisposed).toHaveBeenCalledOnce(); expect(fallbackDisposed).toHaveBeenCalledOnce(); expect(targetDisposed).toHaveBeenCalledOnce()
      expect(disposed).not.toHaveBeenCalled(); expect(geometryDisposed).not.toHaveBeenCalled(); expect(sourceDisposed).not.toHaveBeenCalled()
    } finally { s.dispose(); field.dispose() }
  })

  it('retains MSAA while reconstructing a proxy that covers every viewport sample', () => {
    const s = setup()
    try {
      s.output.samples = 4
      s.render()
      expect(s.draws).toHaveLength(4)
      expect(s.draws[3].target).toBe(s.output)
      expect(s.output.samples).toBe(4)
      expect(s.draws[1].target!.samples).toBe(0)
    } finally { s.dispose() }
  })

  it.each(['near-edge', 'far-clip', 'positions', 'indices', 'pre-upload-positions', 'pre-upload-indices', 'draw-range', 'singular', 'nonfinite'] as const)('uses the MSAA fallback when box coverage is uncertain: %s', mode => {
    const s = setup()
    try {
      s.output.samples = 4
      if (mode === 'near-edge') s.camera.position.x = 1.9999
      if (mode === 'far-clip') { s.camera.far = 1.5; s.camera.updateProjectionMatrix() }
      if (mode === 'positions') s.volume.geometry.translate(.1, 0, 0)
      if (mode === 'indices') s.volume.geometry.index!.needsUpdate = true
      if (mode === 'pre-upload-positions') {
        const positions = s.volume.geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) positions.setXYZ(i, positions.getX(i) * .001, positions.getY(i) * .001, positions.getZ(i) * .001)
      }
      if (mode === 'pre-upload-indices') s.volume.geometry.index!.setX(0, 1)
      if (mode === 'draw-range') s.volume.geometry.setDrawRange(0, 3)
      if (mode === 'singular') s.volume.scale.x = 0
      if (mode === 'nonfinite') s.volume.position.x = NaN
      s.camera.updateMatrixWorld(true)
      s.render()
      expect(s.draws).toHaveLength(2)
      expect(s.draws.every(draw => draw.object === s.volume)).toBe(true)
    } finally { s.dispose() }
  })

  it('resizes the shared scratch and forwards the source callback/material with its current world transform', () => {
    const s = setup()
    try {
      s.volume.position.set(1e8, 2e8, -3e8)
      s.camera.position.copy(s.volume.position).addScalar(1); s.camera.updateMatrixWorld(true)
      s.render()
      const proxy = s.draws[1].object, target = s.draws[1].target!, source = s.volume.material, callback = vi.spyOn(source, 'onBeforeRender')
      expect(proxy.matrix.elements).toEqual(s.volume.matrixWorld.elements)
      proxy.updateMatrixWorld()
      expect(proxy.matrixWorld.elements).toEqual(s.volume.matrixWorld.elements)
      proxy.onBeforeRender(s.renderer as unknown as WebGLRenderer, new Scene(), s.camera, s.volume.geometry, s.draws[1].material, null!)
      expect(source.uniforms.uCameraLocal.value.toArray()).toEqual([1, 1, 1])
      expect(callback.mock.calls[0][4]).toBe(s.volume)
      const targetDisposed = vi.fn(); target.addEventListener('dispose', targetDisposed)
      s.output.setSize(321, 201); s.resolution.set(321, 201); s.draws.length = 0; s.render()
      expect(s.draws[1].target).toBe(target)
      expect([target.width, target.height]).toEqual([321, 201])
      expect(targetDisposed).toHaveBeenCalledOnce()
    } finally { s.dispose() }
  })

  it.each([2, 3, 4])('restores caller state and bindings when draw %s fails', failingDraw => {
    const s = setup(), original = s.renderer.render, material = s.volume.material
    s.renderer.render = object => { original(object); if (s.draws.length === failingDraw) throw new Error('reconstruction draw failed'); return s.draws.length }
    try {
      expect(s.render).toThrow('reconstruction draw failed')
      expect(s.volume.material).toBe(material)
      expect(s.renderer.getRenderTarget()).toBe(s.output)
      expect(s.renderer.autoClear).toBe(true)
      expect(s.renderer.getClearAlpha()).toBe(.4)
      expect(s.renderer.getClearColor(new Color())).toEqual(new Color(.2, .3, .4))
      expect(material.uniforms.uLowResolutionEnabled.value).toBe(0)
      expect(material.uniforms.uLowResolutionMap.value).toBeNull()
    } finally { s.dispose() }
  })

  it.each([0, NaN, Infinity])('does not allocate scratch for an invalid or zero budget %s', budget => {
    const s = setup(), reconstruction = new DepthVolumeReconstructionRenderer(budget)
    try {
      expect(reconstruction.render(s.renderer as unknown as WebGLRenderer, s.output, s.camera, s.volume, s.resolution)).toBe(false)
      expect(s.draws).toHaveLength(0)
    } finally { reconstruction.dispose(); s.dispose() }
  })

  it.each(['antialias', 'stencil'] as const)('retains the native default framebuffer when it has %s', mode => {
    const s = setup(), reconstruction = new DepthVolumeReconstructionRenderer()
    const context = s.renderer.getContext()
    s.renderer.getContext = () => ({ ...context, getContextAttributes: () => ({ antialias: mode === 'antialias', stencil: mode === 'stencil' }) })
    try {
      s.renderer.setRenderTarget(null)
      expect(reconstruction.render(s.renderer as unknown as WebGLRenderer, null, s.camera, s.volume, s.resolution)).toBe(false)
      expect(s.draws).toHaveLength(0)
    } finally { reconstruction.dispose(); s.dispose() }
  })

  it('shares scratch between volumes and releases only removed volume programs', () => {
    const s = setup(), reconstruction = new DepthVolumeReconstructionRenderer()
    const second = new NebulaVolume(mergeNebulaParams())
    try {
      reconstruction.prepare([s.volume, second])
      reconstruction.render(s.renderer as unknown as WebGLRenderer, s.output, s.camera, s.volume, s.resolution)
      reconstruction.render(s.renderer as unknown as WebGLRenderer, s.output, s.camera, second, s.resolution)
      const first = s.draws[0], next = s.draws[3], firstDisposed = vi.fn(), nextDisposed = vi.fn(), targetDisposed = vi.fn()
      expect(first.target).toBe(next.target)
      expect(first.material).not.toBe(next.material)
      first.material.addEventListener('dispose', firstDisposed); next.material.addEventListener('dispose', nextDisposed)
      first.target!.addEventListener('dispose', targetDisposed)
      reconstruction.prepare([second])
      expect(firstDisposed).toHaveBeenCalledOnce(); expect(nextDisposed).not.toHaveBeenCalled(); expect(targetDisposed).not.toHaveBeenCalled()
      reconstruction.prepare([])
      expect(nextDisposed).toHaveBeenCalledOnce(); expect(targetDisposed).toHaveBeenCalledOnce()
    } finally { reconstruction.dispose(); s.dispose(); second.geometry.dispose(); second.material.dispose() }
  })
})
