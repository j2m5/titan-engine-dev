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
export function captureShaderCompilation(renderer: WebGLRenderer, label: string): ShaderCompilationScope {
  const previous = renderer.debug.onShaderError
  const previousCheck = renderer.debug.checkShaderErrors
  let failure: Error | null = null
  let restored = false
  renderer.debug.checkShaderErrors = true
  renderer.debug.onShaderError = (gl, program, vertex, fragment): void => {
    let detail = 'diagnostics unavailable'
    try {
      detail = `${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
    } catch (error) {
      detail = String(error)
    }
    try {
      previous?.(gl, program, vertex, fragment)
    } catch (error) {
      detail += `; previous handler: ${String(error)}`
    }
    failure ??= new Error(`${label} shader compilation failed: ${detail}`)
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
