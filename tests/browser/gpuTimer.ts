/** Native GPU elapsed time only. Never substitute CPU submission time. */
export class GpuTimer {
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number; QUERY_COUNTER_BITS_EXT: number }
  private readonly pending: WebGLQuery[] = []

  public constructor(private readonly gl: WebGL2RenderingContext) {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    if (!ext) throw new Error('Native GPU timer extension is unavailable')
    this.ext = ext
    // DOM's getQuery declaration omits this extension's numeric return overload.
    const counterBits: unknown = gl.getQuery(ext.TIME_ELAPSED_EXT, ext.QUERY_COUNTER_BITS_EXT)
    if (typeof counterBits !== 'number' || counterBits <= 0) {
      throw new Error('GPU elapsed timer has no counter bits')
    }
    // Disjoint state preceding this batch does not describe its measurements.
    gl.getParameter(ext.GPU_DISJOINT_EXT)
  }

  public get pendingCount(): number { return this.pending.length }

  public measure(draw: () => void): void {
    const gl = this.gl, query = gl.createQuery()
    if (!query) throw new Error('Could not allocate GPU timer query')
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query)
    let completed = false
    try {
      draw()
      completed = true
    } finally {
      gl.endQuery(this.ext.TIME_ELAPSED_EXT)
      if (!completed) gl.deleteQuery(query)
    }
    this.pending.push(query)
  }

  /** Call after yielding to the browser. A disjoint batch must be rerun in full. */
  public poll(): number[] {
    const gl = this.gl, values: number[] = []
    try {
      if (gl.isContextLost()) throw new Error('GPU context lost during timing')
      if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) throw new Error('GPU timer disjoint; discard this run')
      while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = this.pending.shift()!
        const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number
        gl.deleteQuery(query)
        if (!Number.isFinite(nanoseconds) || nanoseconds <= 0) throw new Error('Invalid GPU duration')
        values.push(nanoseconds / 1e6)
      }
      return values
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  public dispose(): void {
    for (const query of this.pending) this.gl.deleteQuery(query)
    this.pending.length = 0
  }
}
