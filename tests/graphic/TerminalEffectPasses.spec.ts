import { DepthTexture, HalfFloatType, PerspectiveCamera, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { EffectPass } from 'postprocessing'
import { createEffectPasses } from '@/core/graphic/Postprocessing'

describe('terminal HDR output', () => {
  afterEach(() => vi.restoreAllMocks())

  function setup() {
    const [hdr, ldr] = createEffectPasses(new PerspectiveCamera())
    ldr.renderToScreen = true
    const input = new WebGLRenderTarget(128, 72, { type: HalfFloatType, samples: 8 })
    const output = input.clone()
    output.depthTexture = new DepthTexture(128, 72)
    const renderer = {} as WebGLRenderer
    const render = vi.spyOn(EffectPass.prototype, 'render').mockImplementation(() => {})
    const frame = (stencil = false): void => {
      if (hdr.enabled) hdr.render(renderer, input, output, 0.1, stencil)
      if (ldr.enabled) ldr.render(renderer, hdr.enabled && hdr.needsSwap ? output : input, input, 0.1, stencil)
    }
    return { hdr, ldr, input, output, renderer, render, frame }
  }

  it('writes HDR to a matching color-only target and feeds it to LDR without changing scene MSAA', () => {
    const { input, output, render, frame } = setup()
    frame()
    const target = render.mock.calls[0][2]!
    expect(target).not.toBe(output)
    expect(target.samples).toBe(0)
    expect(target.depthBuffer).toBe(false)
    expect(target.stencilBuffer).toBe(false)
    expect(target.depthTexture).toBeNull()
    for (const property of ['type', 'format', 'internalFormat', 'minFilter', 'magFilter', 'colorSpace'] as const) {
      expect(target.texture[property]).toBe(output.texture[property])
    }
    expect([target.width, target.height]).toEqual([128, 72])
    expect(render.mock.calls[1][1]).toBe(target)
    expect(render.mock.calls[0].slice(3)).toEqual([0.1, false])
    expect([input.samples, output.samples]).toEqual([8, 8])
    expect(output.depthTexture).toBeInstanceOf(DepthTexture)
    frame()
    expect(render.mock.calls[2][2]).toBe(target)
  })

  it.each(['zero samples', 'stencil', 'HDR screen', 'LDR offscreen', 'LDR disabled', 'HDR skipped', 'LDR skipped'])(
    'preserves the composer route for %s', condition => {
      const { hdr, ldr, output, render, frame } = setup()
      if (condition === 'zero samples') output.samples = 0
      if (condition === 'HDR screen') hdr.renderToScreen = true
      if (condition === 'LDR offscreen') ldr.renderToScreen = false
      if (condition === 'LDR disabled') ldr.enabled = false
      if (condition === 'HDR skipped') hdr.needsSwap = false
      if (condition === 'LDR skipped') ldr.needsSwap = false
      frame(condition === 'stencil')
      expect(render.mock.calls[0][2]).toBe(output)
    }
  )

  it('consumes the redirected input once and ignores it if HDR is disabled', () => {
    const { hdr, ldr, input, output, renderer, render, frame } = setup()
    frame()
    ldr.render(renderer, output, input, 0, false)
    expect(render.mock.calls[2][1]).toBe(output)
    hdr.render(renderer, input, output, 0, false)
    hdr.enabled = false
    ldr.render(renderer, output, input, 0, false)
    expect(render.mock.calls[4][1]).toBe(output)
  })

  it('does not redirect an unrelated composer input', () => {
    const { hdr, ldr, input, output, renderer, render } = setup()
    hdr.render(renderer, input, output, 0, false)
    ldr.render(renderer, input, output, 0, false)
    expect(render.mock.calls[1][1]).toBe(input)
  })

  it('clears readiness before HDR and LDR exceptions', () => {
    const { hdr, ldr, input, output, renderer, render, frame } = setup()
    frame()
    render.mockImplementationOnce(() => { throw new Error('HDR failed') })
    expect(() => hdr.render(renderer, input, output, 0, false)).toThrow('HDR failed')
    ldr.render(renderer, output, input, 0, false)
    expect(render.mock.lastCall![1]).toBe(output)
    hdr.render(renderer, input, output, 0, false)
    render.mockImplementationOnce(() => { throw new Error('LDR failed') })
    expect(() => ldr.render(renderer, output, input, 0, false)).toThrow('LDR failed')
    ldr.render(renderer, output, input, 0, false)
    expect(render.mock.lastCall![1]).toBe(output)
  })

  it('resizes the owned target for screenshots and back, without reallocating its owner', () => {
    const { hdr, input, output, render, frame } = setup()
    hdr.setSize(128, 72)
    frame()
    const target = render.mock.calls[0][2]!
    for (const [width, height] of [[3840, 2160], [128, 72]]) {
      input.setSize(width, height)
      output.setSize(width, height)
      hdr.setSize(width, height)
      frame()
      expect(render.mock.calls.at(-2)![2]).toBe(target)
      expect([target.width, target.height]).toEqual([width, height])
      expect(target.samples).toBe(0)
    }
  })

  it('disposes only its own buffer, even when HDR stops before LDR', () => {
    const { hdr, ldr, input, output, renderer, render } = setup()
    const inputDispose = vi.spyOn(input, 'dispose'), outputDispose = vi.spyOn(output, 'dispose')
    const depthDispose = vi.spyOn(output.depthTexture!, 'dispose'), ldrDispose = vi.spyOn(ldr, 'dispose')
    hdr.render(renderer, input, output, 0, false)
    const target = render.mock.calls[0][2]!
    const dispose = vi.spyOn(target, 'dispose')
    hdr.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(inputDispose).not.toHaveBeenCalled()
    expect(outputDispose).not.toHaveBeenCalled()
    expect(depthDispose).not.toHaveBeenCalled()
    expect(ldrDispose).not.toHaveBeenCalled()
    ldr.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('releases the old intermediate before reinitializing', () => {
    const { hdr, renderer, render, frame } = setup()
    frame()
    const old = render.mock.calls[0][2]!, dispose = vi.spyOn(old, 'dispose')
    vi.spyOn(EffectPass.prototype, 'initialize').mockImplementation(() => {})
    hdr.initialize(renderer, false, HalfFloatType)
    expect(dispose).toHaveBeenCalledTimes(1)
    frame()
    expect(render.mock.calls[2][2]).not.toBe(old)
    expect(render.mock.calls[2][2]!.samples).toBe(0)
  })
})
