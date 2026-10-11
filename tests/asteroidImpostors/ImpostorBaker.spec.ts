import { BoxGeometry, Color, Vector4, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { AsteroidImpostorBaker } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidImpostorBaker'
import { createImpostorAtlas } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorResources'
import { createImpostorLayout } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'

vi.mock('@/core/renderables/DetailedRingStreamingSystem/impostors/impostorCopy', () => ({
  ImpostorTextureCopy: class {
    constructor(private renderer: WebGLRenderer) {}
    copy(...args: Parameters<WebGLRenderer['copyTextureToTexture']>) { this.renderer.copyTextureToTexture(...args) }
    dispose() {}
    invalidateGpu() {}
  }
}))

function rendererDouble() {
  let target: WebGLRenderTarget | null = new WebGLRenderTarget(17, 13)
  let layer = 3, mip = 2, scissorTest = true, alpha = 0.6
  const viewport = new Vector4(2, 3, 11, 7), scissor = new Vector4(1, 2, 5, 6), color = new Color(0.2, 0.4, 0.6)
  const framebuffer = vi.fn(() => 36053)
  const renderer = {
    autoClear: true,
    getContext: () => ({ isContextLost: () => false, TEXTURE0: 33984, FRAMEBUFFER: 36160, FRAMEBUFFER_COMPLETE: 36053, checkFramebufferStatus: framebuffer }),
    state: { activeTexture: vi.fn() },
    getRenderTarget: () => target,
    getActiveCubeFace: () => layer,
    getActiveMipmapLevel: () => mip,
    getViewport: (v: Vector4) => v.copy(viewport),
    getScissor: (v: Vector4) => v.copy(scissor),
    getScissorTest: () => scissorTest,
    getClearColor: (c: Color) => c.copy(color),
    getClearAlpha: () => alpha,
    setRenderTarget: (t: WebGLRenderTarget | null, l = 0, m = 0) => { target = t; layer = l; mip = m },
    setViewport: (v: Vector4) => viewport.copy(v),
    setScissor: (v: Vector4) => scissor.copy(v),
    setScissorTest: (v: boolean) => { scissorTest = v },
    setClearColor: (c: Color | number, a = 1) => { color.set(c); alpha = a },
    initRenderTarget: vi.fn(), clear: vi.fn(), render: vi.fn(), copyTextureToTexture: vi.fn()
  }
  const state = () => ({ target, layer, mip, viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest, alpha, color: color.toArray(), autoClear: renderer.autoClear })
  return { renderer: renderer as unknown as WebGLRenderer, state, draw: renderer.render, copy: renderer.copyTextureToTexture, framebuffer }
}

describe('пошаговое запекание импостора', () => {
  const layout = createImpostorLayout(2, 4)
  function setup() {
    const double = rendererDouble()
    const atlas = createImpostorAtlas(double.renderer, layout, 2)
    const baker = new AsteroidImpostorBaker(double.renderer, layout, 4)
    const source = new BoxGeometry(1, 2, 3)
    return { ...double, atlas, baker, source }
  }

  it('пишет все ракурсы и mip-уровни до публикации и восстанавливает состояние', () => {
    const { renderer, state, draw, copy, atlas, baker, source } = setup()
    const before = state()
    baker.begin(source, atlas, 2)
    expect(() => baker.finish()).toThrow()
    expect(baker.step(1, 1000)).toBe('pending')
    expect(draw).toHaveBeenCalledTimes(1)
    expect(state()).toEqual(before)
    expect(() => baker.begin(source, atlas, 0)).toThrow()
    while (baker.step(1, 1000) !== 'complete') { /* Порции по одному ракурсу. */ }
    expect(draw).toHaveBeenCalledTimes(6)
    expect(copy).toHaveBeenCalledTimes(18)
    const atlasCopies = copy.mock.calls.filter(call => call[1] === atlas.normalDepth || call[1] === atlas.surfaceCoverage)
    expect(atlasCopies.map(call => [call[3].z, call[4], call[5]])).toEqual([[2, 0, 0], [2, 0, 0], [2, 1, 1], [2, 1, 1], [2, 2, 2], [2, 2, 2]])
    const result = baker.finish()
    expect(result.boundRadius).toBeCloseTo(Math.sqrt(3.5), 12)
    expect(result.halfExtent).toBeCloseTo(1.05 * Math.sqrt(3.5), 12)
    expect(state()).toEqual(before)
    expect(renderer.autoClear).toBe(true)
    baker.dispose()
  })

  it('не меняет и не уничтожает заимствованную геометрию', () => {
    const { baker, source, atlas } = setup()
    const attributes = () => Object.fromEntries(Object.entries(source.attributes).map(([key, attr]) => [key, Array.from(attr.array)]))
    const original = attributes(), disposed = vi.fn()
    source.addEventListener('dispose', disposed)
    baker.begin(source, atlas, 0)
    baker.step(1, 1000)
    baker.cancel()
    expect(attributes()).toEqual(original)
    expect(disposed).not.toHaveBeenCalled()
    expect(() => baker.finish()).toThrow()
    baker.begin(source, atlas, 1)
    baker.cancel()
    baker.dispose()
  })

  it.each([1, 9, 13])('восстанавливает renderer после сбоя copy №%i и разрешает отмену', failAt => {
    const { baker, source, atlas, copy, state } = setup()
    const before = state()
    let calls = 0
    copy.mockImplementation(() => { if (++calls === failAt) throw new Error('copy failed') })
    baker.begin(source, atlas, 0)
    expect(() => baker.step(64, 1000)).toThrow('copy failed')
    expect(state()).toEqual(before)
    expect(() => baker.finish()).toThrow()
    baker.cancel()
    copy.mockReset()
    baker.begin(source, atlas, 0)
    expect(baker.step(64, 1000)).toBe('complete')
    baker.finish()
    baker.dispose()
  })

  it('отклоняет неверный слой и вырожденную форму до GPU-операций', () => {
    const { baker, source, atlas, draw } = setup()
    expect(() => baker.begin(source, atlas, 3)).toThrow()
    source.scale(0, 0, 0)
    expect(() => baker.begin(source, atlas, 0)).toThrow()
    expect(draw).not.toHaveBeenCalled()
    baker.dispose()
  })

  it('останавливает страницу при incomplete framebuffer и восстанавливает renderer', () => {
    const { baker, source, atlas, framebuffer, state } = setup()
    const before = state()
    framebuffer.mockReturnValue(36054)
    baker.begin(source, atlas, 0)
    expect(() => baker.step(1, 1000)).toThrow('framebuffer')
    expect(state()).toEqual(before)
    baker.dispose()
  })

  it('завершает страницу с единственным используемым mip', () => {
    const { renderer, draw } = rendererDouble()
    const smallest = createImpostorLayout(2, 1), atlas = createImpostorAtlas(renderer, smallest, 1)
    const baker = new AsteroidImpostorBaker(renderer, smallest, 0)
    baker.begin(new BoxGeometry(), atlas, 0)
    expect(baker.step(8, 1000)).toBe('complete')
    expect(draw).toHaveBeenCalledTimes(4)
    baker.finish()
    baker.dispose()
  })
})
