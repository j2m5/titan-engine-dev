import { Effect, EffectPass } from 'postprocessing'
import type { Camera, WebGLRenderer, WebGLRenderTarget } from 'three'

/** Keep the composer pair and its swaps; only the final HDR color needs no MSAA. */
export function createTerminalEffectPasses(
  camera: Camera,
  hdrEffects: readonly Effect[],
  ldrEffects: readonly Effect[]
): readonly [EffectPass, EffectPass] {
  // Closures keep the peer out of Pass.dispose's shallow disposable-property scan.
  const hdr: TerminalHdrPass = new TerminalHdrPass(camera, () => ldr, ...hdrEffects)
  const ldr: TerminalLdrPass = new TerminalLdrPass(camera, () => hdr, ...ldrEffects)
  return [hdr, ldr]
}

class TerminalHdrPass extends EffectPass {
  private colorTarget: WebGLRenderTarget | null = null
  private expectedInput: WebGLRenderTarget | null = null

  public constructor(camera: Camera, private readonly destination: () => EffectPass, ...effects: Effect[]) {
    super(camera, ...effects)
  }

  public override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
    deltaTime?: number,
    stencilTest?: boolean
  ): void {
    this.expectedInput = null
    const ldr = this.destination()
    if (this.renderToScreen || !this.needsSwap || !ldr.enabled || !ldr.needsSwap ||
      !ldr.renderToScreen || stencilTest || !outputBuffer || outputBuffer.samples === 0) {
      super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)
      return
    }

    if (!this.colorTarget) {
      this.colorTarget = outputBuffer.clone()
      // RenderTarget.clone also clones its depth texture; the scene owns the original.
      this.colorTarget.depthTexture?.dispose()
      this.colorTarget.depthTexture = null
      this.colorTarget.samples = 0
      this.colorTarget.depthBuffer = false
      this.colorTarget.stencilBuffer = false
    }
    super.render(renderer, inputBuffer, this.colorTarget, deltaTime, stencilTest)
    this.expectedInput = outputBuffer
  }

  public takeOutput(inputBuffer: WebGLRenderTarget | null): WebGLRenderTarget | null {
    const result = this.enabled && this.expectedInput !== null && this.expectedInput === inputBuffer
      ? this.colorTarget : null
    this.expectedInput = null
    return result
  }

  public override setSize(width: number, height: number): void {
    this.expectedInput = null
    super.setSize(width, height)
    this.colorTarget?.setSize(width, height)
  }

  public override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: number): void {
    this.releaseTarget()
    super.initialize(renderer, alpha, frameBufferType)
  }

  private releaseTarget(): void {
    const target = this.colorTarget
    this.colorTarget = null
    this.expectedInput = null
    target?.dispose()
  }

  public override dispose(): void {
    // Clear the borrowed composer target before the inherited disposal scan.
    try {
      this.releaseTarget()
    } finally {
      super.dispose()
    }
  }
}

class TerminalLdrPass extends EffectPass {
  public constructor(camera: Camera, private readonly source: () => TerminalHdrPass, ...effects: Effect[]) {
    super(camera, ...effects)
  }

  public override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
    deltaTime?: number,
    stencilTest?: boolean
  ): void {
    const input = this.source().takeOutput(inputBuffer) ?? inputBuffer
    super.render(renderer, input, outputBuffer, deltaTime, stencilTest)
  }
}
