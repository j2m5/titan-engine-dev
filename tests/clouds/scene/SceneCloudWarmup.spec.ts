import { describe, expect, it, vi } from 'vitest'
import { Color, PerspectiveCamera, Scene, Vector2, Vector4, WebGLRenderTarget } from 'three'
import { CloudEndpointCapturePass, SceneCloudComposition } from '@/core/graphic/clouds/SceneCloudComposition'

function fixture() {
  const camera = new PerspectiveCamera(),
    scene = new Scene(),
    target = new WebGLRenderTarget(),
    capture = new CloudEndpointCapturePass()
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    TIMEOUT_EXPIRED: 0x911b,
    CONDITION_SATISFIED: 0x911c,
    WAIT_FAILED: 0x911d,
    getContextAttributes: () => ({ antialias: false }),
    fenceSync: vi.fn(() => ({})),
    clientWaitSync: vi.fn(() => 0x911b),
    deleteSync: vi.fn(),
    flush: vi.fn()
  }
  const renderer = {
    debug: { checkShaderErrors: false, onShaderError: undefined },
    autoClear: true,
    shadowMap: { autoUpdate: true },
    capabilities: { maxSamples: 0 },
    extensions: { has: () => false },
    getContext: () => gl,
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getViewport: (value: Vector4) => value.set(1, 2, 4, 4),
    getScissor: (value: Vector4) => value.set(2, 1, 3, 3),
    getScissorTest: () => true,
    getClearColor: (value: Color) => value.set(0),
    getClearAlpha: () => 1,
    getSize: (value: Vector2) => value.set(4, 4),
    setClearColor: vi.fn(),
    setRenderTarget: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    clear: () => {},
    render: () => {}
  }
  const runtime = {
    preparationGeneration: 1,
    prepareVolume: () => true,
    diagnostics: { state: 'prepared', effectiveWeight: 0 },
    getPreparationMaterialBindings: () => new Map(),
    getEndpointMaterialOwners: () => new Map(),
    getEndpointMaterialBindings: () => new Map(),
    recordPasses: vi.fn(),
    useEndpoint: vi.fn((plan, _output, activate) => {
      if (plan && activate) runtime.diagnostics.effectiveWeight = 0.05
    }),
    deferVolume: vi.fn(() => null),
    invalidate: vi.fn(),
    renderVolume: vi.fn((_renderer, _input, plan) => ({ frame: plan.frame }))
  }
  const composer = {
    inputBuffer: target,
    setSize: () => {},
    dispose: () => {},
    render: vi.fn(() => {
      camera.layers.set(28)
      renderer.shadowMap.autoUpdate = false
      renderer.autoClear = false
      capture.render(renderer as never, target)
    })
  }
  const atmosphere = { setFrame: vi.fn(), setCloudOverlay: vi.fn() }
  const composition = new SceneCloudComposition(renderer as never, scene, camera, runtime as never, () => ({
    composer: composer as never,
    atmosphere: atmosphere as never,
    capture
  }))
  const prepare = (serial: number) =>
    composition.prepare(
      { frame: { viewport: new Vector2(4, 4), serial, sceneCamera: camera, deltaSeconds: 1 / 60 } } as never,
      {} as never
    )
  const restored = () => {
    expect(camera.layers.mask).toBe(1)
    expect(renderer.autoClear).toBe(true)
    expect(renderer.shadowMap.autoUpdate).toBe(true)
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null, 0, 0)
    expect(renderer.setViewport).toHaveBeenLastCalledWith(new Vector4(1, 2, 4, 4))
    expect(renderer.setScissor).toHaveBeenLastCalledWith(new Vector4(2, 1, 3, 3))
    expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true)
    expect(renderer.debug).toEqual({ checkShaderErrors: false, onShaderError: undefined })
    expect(atmosphere.setFrame).toHaveBeenLastCalledWith(null)
    expect(atmosphere.setCloudOverlay).toHaveBeenLastCalledWith(null)
  }
  const dispose = () => {
    composition.dispose()
    capture.dispose()
    target.dispose()
  }
  return { composition, prepare, restored, dispose, gl, runtime, composer, target }
}

describe('scene cloud GPU warmup', () => {
  it('keeps the far endpoint while busy and publishes a fresh frame only after the GPU signals', () => {
    const f = fixture()
    try {
      expect(f.prepare(1)).toBeNull()
      expect(f.gl.fenceSync).toHaveBeenCalledWith(f.gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      expect(f.gl.flush).toHaveBeenCalledOnce()
      expect(f.runtime.useEndpoint).toHaveBeenCalledWith(expect.anything(), expect.anything(), false)
      expect(f.prepare(2)).toBeNull()
      expect(f.gl.clientWaitSync).toHaveBeenCalledWith(f.gl.fenceSync.mock.results[0].value, 0, 0)
      expect(f.runtime.renderVolume).toHaveBeenCalledTimes(1)
      expect(f.composer.render).toHaveBeenCalledTimes(1)
      expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
      f.restored()

      f.gl.clientWaitSync.mockReturnValue(f.gl.CONDITION_SATISFIED)
      const result = f.prepare(3)
      expect(result?.output.frame.serial).toBe(3)
      expect(result?.texture).toBe(f.target.texture)
      expect(result?.weight).toBe(0.05)
      expect(f.runtime.renderVolume).toHaveBeenCalledTimes(2)
      expect(f.gl.deleteSync).toHaveBeenCalledOnce()
      expect(f.gl.fenceSync).toHaveBeenCalledOnce()
      expect(f.runtime.invalidate).not.toHaveBeenCalled()
      f.restored()
    } finally {
      f.dispose()
    }
    expect(f.gl.deleteSync).toHaveBeenCalledOnce()
  })

  it('deletes a canceled pending fence exactly once and starts a new hidden frame', () => {
    const f = fixture()
    try {
      f.prepare(1)
      f.composition.cancelPreparation()
      f.composition.cancelPreparation()
      expect(f.gl.deleteSync).toHaveBeenCalledOnce()
      expect(f.prepare(2)).toBeNull()
      expect(f.gl.clientWaitSync).not.toHaveBeenCalled()
      expect(f.gl.fenceSync).toHaveBeenCalledTimes(2)
      expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
      f.restored()
    } finally {
      f.dispose()
    }
    expect(f.gl.deleteSync).toHaveBeenCalledTimes(2)
  })

  it('discards an old generation even when its GPU fence has signaled', () => {
    const f = fixture()
    try {
      f.prepare(1)
      f.gl.clientWaitSync.mockReturnValue(f.gl.CONDITION_SATISFIED)
      f.runtime.preparationGeneration++
      expect(f.prepare(2)).toBeNull()
      expect(f.gl.clientWaitSync).not.toHaveBeenCalled()
      expect(f.gl.deleteSync).toHaveBeenCalledOnce()
      expect(f.gl.fenceSync).toHaveBeenCalledTimes(2)
      expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
    } finally {
      f.dispose()
    }
  })

  it('invalidates a failed wait and restores the renderer without publishing stale output', () => {
    const f = fixture()
    try {
      f.prepare(1)
      f.gl.clientWaitSync.mockReturnValue(f.gl.WAIT_FAILED)
      expect(f.prepare(2)).toBeNull()
      expect(f.runtime.invalidate).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: 'Cloud GPU warmup fence failed' }),
        undefined
      )
      expect(f.runtime.renderVolume).toHaveBeenCalledTimes(1)
      expect(f.gl.deleteSync).toHaveBeenCalledOnce()
      expect(f.runtime.diagnostics.effectiveWeight).toBe(0)
      f.restored()
    } finally {
      f.dispose()
    }
    expect(f.gl.deleteSync).toHaveBeenCalledOnce()
  })
})
