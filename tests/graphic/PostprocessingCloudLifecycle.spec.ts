import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene, Vector2, WebGLRenderTarget } from 'three'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { LensRegistry } from '@/core/services/LensRegistry'

function fixture() {
  const canvas = document.createElement('canvas')
  const runtime = {
    bindRenderer: vi.fn(),
    setOptions: vi.fn(),
    setContextLost: vi.fn(),
    resetHistory: vi.fn(),
    resetScenario: vi.fn(),
    beginFrame: vi.fn(),
    recordPasses: vi.fn()
  }
  const settings = { showMarkers: true, showOrbitLines: true, showClouds: false, cloudQuality: 'low' as const }
  const renderer = {
    domElement: canvas,
    getContext: vi.fn(() => ({ isContextLost: (): boolean => false })),
    getSize: (v: Vector2) => v.set(960, 540),
    getDrawingBufferSize: (v: Vector2) => v.set(960, 540),
    getRenderTarget: vi.fn((): WebGLRenderTarget | null => null),
    setRenderTarget: vi.fn()
  }
  const pp = new Postprocessing(
    renderer as never,
    new Scene(),
    new PerspectiveCamera(),
    new AtmosphereRegistry(),
    null as never,
    new LensRegistry(),
    runtime as never,
    settings
  )
  const composer = {
    render: vi.fn(),
    dispose: vi.fn(),
    inputBuffer: new WebGLRenderTarget(),
    outputBuffer: new WebGLRenderTarget()
  }
  pp.composer = composer as never
  return { pp, canvas, runtime, settings, composer, renderer }
}
describe('postprocessing cloud lifecycle', () => {
  it('disposes old composers at loss and rebuilds only afterward, without resurrecting disposed scenes', () => {
    const f = fixture(),
      initialize = vi.spyOn(f.pp, 'initialize').mockImplementation(() => {})
    f.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(f.composer.dispose).toHaveBeenCalledOnce()
    f.canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(initialize).toHaveBeenCalledOnce()
    expect(f.composer.dispose.mock.invocationCallOrder[0]).toBeLessThan(initialize.mock.invocationCallOrder[0])
    f.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    f.pp.dispose()
    initialize.mockClear()
    f.canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(initialize).not.toHaveBeenCalled()
  })
  it('defers initialization intent while actually lost without creating a composer', () => {
    const f = fixture()
    f.pp.composer = null
    f.renderer.getContext.mockReturnValue({ isContextLost: () => true })
    expect(() => f.pp.initialize()).not.toThrow()
    expect(f.pp.composer).toBeNull()
    expect(f.runtime.setContextLost).toHaveBeenCalledWith(true)
    f.pp.dispose()
  })
  it.each([true, false])('detaches a bound target only when owned by the composer: %s', (owned) => {
    const f = fixture(),
      foreign = new WebGLRenderTarget()
    f.renderer.getRenderTarget.mockReturnValue(owned ? f.composer.inputBuffer : foreign)
    f.composer.dispose.mockImplementation(() => {
      expect(f.renderer.setRenderTarget.mock.calls).toEqual(owned ? [[null]] : [])
    })
    f.pp.dispose()
    foreign.dispose()
    f.composer.inputBuffer.dispose()
    f.composer.outputBuffer.dispose()
  })
  it('reads the core settings port and uses physical dimensions and fresh presentation serials', () => {
    const f = fixture()
    f.pp.render(0.016)
    f.pp.render(0)
    expect(f.runtime.setOptions).toHaveBeenCalledWith(false, 'low')
    expect(f.runtime.beginFrame.mock.calls.map((call) => [call[1].toArray(), call[2], call[3]])).toEqual([
      [[960, 540], 1, 0.016],
      [[960, 540], 2, 0]
    ])
  })
  it('explicit jumps invalidate history; scenario teardown cancels jobs', () => {
    const f = fixture()
    f.pp.invalidateCloudHistory()
    expect(f.runtime.resetHistory).toHaveBeenCalledOnce()
    f.pp.dispose()
    expect(f.runtime.resetScenario).toHaveBeenCalledOnce()
  })
  it('prevents draws during context loss and removes its named listeners on teardown', () => {
    const f = fixture()
    const loss = new Event('webglcontextlost', { cancelable: true })
    f.canvas.dispatchEvent(loss)
    expect(loss.defaultPrevented).toBe(true)
    expect(f.runtime.setContextLost).toHaveBeenCalledWith(true)
    expect(f.composer.dispose).toHaveBeenCalledOnce()
    f.pp.render(0.016)
    expect(f.composer.render).not.toHaveBeenCalled()
    f.pp.dispose()
    f.runtime.setContextLost.mockClear()
    f.canvas.dispatchEvent(new Event('webglcontextlost'))
    f.canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(f.runtime.setContextLost).not.toHaveBeenCalled()
  })
})
