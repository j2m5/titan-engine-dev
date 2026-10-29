import { DepthTexture, HalfFloatType, PerspectiveCamera, Texture, WebGLRenderTarget, type ShaderMaterial, type WebGLRenderer } from 'three'
import { EffectPass } from 'postprocessing'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import { CloudRegistry } from '@/core/services/CloudRegistry'
import { CloudBlendPass } from '@/core/graphic/clouds/CloudBlendPass'

describe('atmosphere output before terminal HDR', () => {
  afterEach(() => vi.restoreAllMocks())

  function setup(withClouds = false) {
    const runtime = withClouds ? new SceneCloudRuntime(new CloudRegistry()) : undefined
    const passes = new Postprocessing({} as WebGLRenderer, null as never, new PerspectiveCamera(),
      new AtmosphereRegistry(), new DepthVolumeRegistry(), undefined, runtime).buildPasses()
    const atmosphere = passes[7] as EffectPass
    const [hdr, ldr] = passes.slice(-2) as EffectPass[]
    const blend = passes.find(pass => pass instanceof CloudBlendPass)
    ldr.renderToScreen = true
    const input = new WebGLRenderTarget(128, 72, { type: HalfFloatType, samples: 8 })
    const output = input.clone(), depth = new DepthTexture(128, 72)
    output.depthTexture = depth
    atmosphere.setDepthTexture(depth)
    const renderer = { setRenderTarget: vi.fn(), render: vi.fn() } as unknown as WebGLRenderer
    const render = vi.spyOn(EffectPass.prototype, 'render').mockImplementation(() => {})
    const frame = (stencil = false): void => {
      let read = input, write = output
      for (const pass of passes.slice(7)) if (pass.enabled) {
        pass.render(renderer, read, write, 0.1, stencil)
        if (pass.needsSwap) [read, write] = [write, read]
      }
    }
    return { atmosphere, hdr, ldr, blend, runtime, passes, input, output, depth, renderer, render, frame }
  }

  it('routes completed cloud blend to HDR and restores direct atmosphere color when clouds leave', () => {
    const { atmosphere, blend, runtime, passes, input, output, render, frame } = setup(true)
    const near = new Texture()
    try {
      frame()
      const directAtmosphere = render.mock.calls[0][2]!
      expect(directAtmosphere.samples).toBe(0)
      expect(render.mock.calls[1][1]).toBe(directAtmosphere)

      blend!.setNear(near, 0.5)
      frame()
      expect(render.mock.calls[3][2]).toBe(output)
      expect((blend!.fullscreenMaterial as ShaderMaterial).uniforms.inputBuffer.value).toBe(output.texture)
      expect(render.mock.calls[4][1]).toBe(input)
      expect(render.mock.calls[4][2]!.samples).toBe(0)
      expect(render.mock.calls[5][1]).toBe(render.mock.calls[4][2])

      atmosphere.enabled = false
      blend!.setNear(near, 1)
      frame()
      expect(render.mock.calls[6][1]).toBe(output)

      atmosphere.enabled = true
      blend!.setNear(null, 0)
      frame()
      expect(render.mock.calls[8][2]).toBe(directAtmosphere)
      expect(render.mock.calls[9][1]).toBe(directAtmosphere)
    } finally {
      for (const pass of passes) pass.dispose()
      runtime!.dispose()
      near.dispose()
      input.dispose()
      output.dispose()
    }
  })

  it('feeds atmosphere color to HDR and HDR color to LDR while preserving original scene depth and MSAA', () => {
    const { atmosphere, input, output, depth, render, frame } = setup()
    frame()
    const atmoTarget = render.mock.calls[0][2]!, hdrTarget = render.mock.calls[1][2]!
    expect(atmoTarget).not.toBe(output)
    expect(hdrTarget).not.toBe(input)
    expect(atmoTarget).not.toBe(hdrTarget)
    for (const target of [atmoTarget, hdrTarget]) {
      expect(target.samples).toBe(0)
      expect(target.depthBuffer).toBe(false)
      expect(target.stencilBuffer).toBe(false)
      expect(target.depthTexture).toBeNull()
      expect([target.width, target.height]).toEqual([128, 72])
      for (const property of ['type', 'format', 'internalFormat', 'minFilter', 'magFilter', 'colorSpace'] as const) {
        expect(target.texture[property]).toBe(input.texture[property])
      }
    }
    expect(render.mock.calls[1][1]).toBe(atmoTarget)
    expect(render.mock.calls[2][1]).toBe(hdrTarget)
    expect(render.mock.calls[0].slice(3)).toEqual([0.1, false])
    expect(atmosphere.getDepthTexture()).toBe(depth)
    expect(output.depthTexture).toBe(depth)
    expect([input.samples, output.samples]).toEqual([8, 8])
    frame()
    expect(render.mock.calls[3][2]).toBe(atmoTarget)
    expect(render.mock.calls[4][2]).toBe(hdrTarget)
  })

  it.each(['zero samples', 'stencil', 'atmosphere screen', 'atmosphere skipped', 'HDR disabled',
    'HDR skipped', 'HDR screen', 'LDR disabled', 'LDR skipped', 'LDR offscreen'])(
    'keeps the composer atmosphere output for %s', condition => {
      const { atmosphere, hdr, ldr, output, render, frame } = setup()
      if (condition === 'zero samples') output.samples = 0
      if (condition === 'atmosphere screen') atmosphere.renderToScreen = true
      if (condition === 'atmosphere skipped') atmosphere.needsSwap = false
      if (condition === 'HDR disabled') hdr.enabled = false
      if (condition === 'HDR skipped') hdr.needsSwap = false
      if (condition === 'HDR screen') hdr.renderToScreen = true
      if (condition === 'LDR disabled') ldr.enabled = false
      if (condition === 'LDR skipped') ldr.needsSwap = false
      if (condition === 'LDR offscreen') ldr.renderToScreen = false
      frame(condition === 'stencil')
      expect(render.mock.calls[0][2]).toBe(output)
    }
  )

  it('keeps terminal HDR optimization when atmosphere is disabled', () => {
    const { atmosphere, input, render, frame } = setup()
    atmosphere.enabled = false
    frame()
    expect(render.mock.calls[0][1]).toBe(input)
    expect(render.mock.calls[0][2]!.samples).toBe(0)
    expect(render.mock.calls[1][1]).toBe(render.mock.calls[0][2])
  })

  it('consumes atmosphere output only once, ignores unrelated input and clears it if disabled', () => {
    const { atmosphere, hdr, input, output, renderer, render } = setup()
    atmosphere.render(renderer, input, output)
    hdr.render(renderer, input, output)
    expect(render.mock.lastCall![1]).toBe(input)
    hdr.render(renderer, output, input)
    expect(render.mock.lastCall![1]).toBe(output)
    atmosphere.render(renderer, input, output)
    hdr.render(renderer, output, input)
    expect(render.mock.lastCall![1]).not.toBe(output)
    hdr.render(renderer, output, input)
    expect(render.mock.lastCall![1]).toBe(output)
    atmosphere.render(renderer, input, output)
    atmosphere.enabled = false
    hdr.render(renderer, output, input)
    expect(render.mock.lastCall![1]).toBe(output)
  })

  it('does not reuse atmosphere output after an atmosphere or HDR exception', () => {
    const { atmosphere, hdr, input, output, renderer, render, frame } = setup()
    frame()
    render.mockImplementationOnce(() => { throw new Error('atmosphere failed') })
    expect(() => atmosphere.render(renderer, input, output)).toThrow('atmosphere failed')
    hdr.render(renderer, output, input)
    expect(render.mock.lastCall![1]).toBe(output)
    atmosphere.render(renderer, input, output)
    render.mockImplementationOnce(() => { throw new Error('HDR failed') })
    expect(() => hdr.render(renderer, output, input)).toThrow('HDR failed')
    hdr.render(renderer, output, input)
    expect(render.mock.lastCall![1]).toBe(output)
  })

  it('resizes and reinitializes both owned targets, including screenshot restoration', () => {
    const { atmosphere, hdr, input, output, renderer, render, frame } = setup()
    frame()
    const targets = [render.mock.calls[0][2]!, render.mock.calls[1][2]!]
    for (const [width, height] of [[3840, 2160], [128, 72]]) {
      input.setSize(width, height); output.setSize(width, height)
      atmosphere.setSize(width, height); hdr.setSize(width, height)
      frame()
      expect([render.mock.calls.at(-3)![2], render.mock.calls.at(-2)![2]]).toEqual(targets)
      for (const target of targets) expect([target.width, target.height, target.samples]).toEqual([width, height, 0])
    }
    const disposes = targets.map(target => vi.spyOn(target, 'dispose'))
    vi.spyOn(EffectPass.prototype, 'initialize').mockImplementation(() => {})
    atmosphere.initialize(renderer, false, HalfFloatType); hdr.initialize(renderer, false, HalfFloatType)
    for (const dispose of disposes) expect(dispose).toHaveBeenCalledTimes(1)
    frame()
    expect(render.mock.calls.at(-3)![2]).not.toBe(targets[0])
    expect(render.mock.calls.at(-2)![2]).not.toBe(targets[1])
  })

  it('disposes an interrupted atmosphere output without disposing scene depth, borrowed targets or peers', () => {
    const { atmosphere, hdr, ldr, input, output, depth, renderer, render } = setup()
    const borrowed = [input, output, depth, hdr, ldr].map(value => vi.spyOn(value, 'dispose'))
    atmosphere.render(renderer, input, output)
    const own = vi.spyOn(render.mock.calls[0][2]!, 'dispose')
    atmosphere.dispose()
    expect(own).toHaveBeenCalledTimes(1)
    for (const dispose of borrowed) expect(dispose).not.toHaveBeenCalled()
    hdr.dispose(); ldr.dispose()
    expect(own).toHaveBeenCalledTimes(1)
  })
})
