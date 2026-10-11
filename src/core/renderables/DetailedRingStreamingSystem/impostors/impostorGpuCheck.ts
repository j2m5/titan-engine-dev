import type { WebGLRenderer } from 'three'

/** Three сообщает ошибки программы callback-ом, без исключения из render. */
export function checkedImpostorGpu<T>(renderer: WebGLRenderer, action: () => T): T {
  const previous = renderer.debug.onShaderError
  let shaderFailed = false
  renderer.debug.onShaderError = (...args) => {
    shaderFailed = true
    previous?.(...args)
  }
  try {
    const gl = renderer.getContext()
    if (gl.isContextLost()) throw new Error('Контекст WebGL потерян')
    const result = action()
    if (gl.isContextLost()) throw new Error('Контекст WebGL потерян')
    const error = gl.getError()
    if (shaderFailed) throw new Error('Ошибка шейдера импостора')
    if (error !== gl.NO_ERROR) throw new Error(`Ошибка WebGL импостора: ${error}`)
    return result
  } finally {
    renderer.debug.onShaderError = previous
  }
}
