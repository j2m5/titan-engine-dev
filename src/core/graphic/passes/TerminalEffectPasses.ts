import { Effect, EffectPass } from 'postprocessing'
import type { Camera, WebGLRenderer, WebGLRenderTarget } from 'three'

/** Adjacent composer passes in the returned order; only final HDR color needs no MSAA. */
export function createTerminalEffectPasses(
  camera: Camera,
  hdrEffects: readonly Effect[],
  ldrEffects: readonly Effect[]
): readonly [EffectPass, EffectPass] {
  const passes = createColorPasses(camera, [hdrEffects, ldrEffects])
  return [passes[0], passes[1]]
}

/** Bloom must see completed atmosphere color; disable direct output while an intervening pass runs. */
export function createAtmosphereEffectPasses(
  camera: Camera,
  atmosphere: Effect,
  hdrEffects: readonly Effect[],
  ldrEffects: readonly Effect[],
  canRedirectAtmosphere: () => boolean = () => true
): readonly [EffectPass, EffectPass, EffectPass] {
  const passes = createColorPasses(camera, [[atmosphere], hdrEffects, ldrEffects],
    index => index !== 0 || canRedirectAtmosphere())
  return [passes[0], passes[1], passes[2]]
}

function createColorPasses(
  camera: Camera,
  effects: readonly (readonly Effect[])[],
  canRedirect: (index: number) => boolean = () => true
): ColorOutputPass[] {
  // Closures keep peers out of Pass.dispose's shallow disposable-property scan.
  const passes: ColorOutputPass[] = effects.map((group, index) => new ColorOutputPass(
    camera,
    () => passes[index - 1] ?? null,
    () => {
      if (!canRedirect(index)) return false
      for (let next = index + 1; next < passes.length; next++) {
        const pass = passes[next]
        if (!pass.enabled || !pass.needsSwap ||
          (next === passes.length - 1 ? !pass.renderToScreen : pass.renderToScreen)) return false
      }
      return index < passes.length - 1
    },
    ...group
  ))
  return passes
}

class ColorOutputPass extends EffectPass {
  private colorTarget: WebGLRenderTarget | null = null
  private expectedInput: WebGLRenderTarget | null = null

  public constructor(
    camera: Camera,
    private readonly source: () => ColorOutputPass | null,
    private readonly canRedirect: () => boolean,
    ...effects: Effect[]
  ) {
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
    const input = this.source()?.takeOutput(inputBuffer) ?? inputBuffer
    if (this.renderToScreen || !this.needsSwap || !this.canRedirect() ||
      stencilTest || !outputBuffer || outputBuffer.samples === 0) {
      super.render(renderer, input, outputBuffer, deltaTime, stencilTest)
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
    super.render(renderer, input, this.colorTarget, deltaTime, stencilTest)
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
