import type { Material, WebGLRenderer } from 'three'

/** Preserve successful first-attempt sharing; a failure epoch isolates retries from retained bad programs. */
export function appendProgramCacheKey(material: Material, suffix: string | undefined): void {
  if (!suffix) return
  const previous = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${previous()};${suffix}`
}

export interface ShaderCompilationScope {
  readonly failed: boolean
  /** Call only after renderer.render/compile or the enclosing public update has returned. */
  check(): void
  restore(): void
}

/** Three's render/compile stacks are not exception-safe. Never throw from its diagnostic callback. */
export function captureShaderCompilation(
  renderer: WebGLRenderer,
  label: string,
  observeFailure?: (reentrant: boolean) => void
): ShaderCompilationScope {
  const previous = renderer.debug.onShaderError
  const previousCheck = renderer.debug.checkShaderErrors
  let failure: Error | null = null
  let restored = false
  let diagnosticDepth = 0
  renderer.debug.checkShaderErrors = true
  renderer.debug.onShaderError = (gl, program, vertex, fragment): void => {
    const reentrant = diagnosticDepth++ > 0
    try {
      let detail = 'diagnostics unavailable'
      // Snapshot attribution before previous callbacks can initiate arbitrary nested rendering.
      try {
        observeFailure?.(reentrant)
      } catch (error) {
        detail += `; observer: ${String(error)}`
      }
      try {
        detail = `${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
      } catch (error) {
        detail = String(error)
      }
      const diagnostic = new Error(`${label} shader compilation failed: ${detail}`)
      failure ??= diagnostic
      try {
        previous?.(gl, program, vertex, fragment)
      } catch (error) {
        diagnostic.message += `; previous handler: ${String(error)}`
      }
    } finally {
      diagnosticDepth--
    }
  }
  return {
    get failed() {
      return failure !== null
    },
    check() {
      if (failure) throw failure
    },
    restore() {
      if (restored) return
      restored = true
      renderer.debug.onShaderError = previous
      renderer.debug.checkShaderErrors = previousCheck
    }
  }
}
