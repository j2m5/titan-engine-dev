export interface GpuSample {
  frame: number
  ms: number
}
export function assertHardwareRenderer(renderer: string | null): asserts renderer is string {
  if (
    !renderer?.trim() ||
    /^(?:WebKit WebGL|WebGL|ANGLE)$/i.test(renderer) ||
    /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|\bwarp\b|gdi generic/i.test(renderer)
  )
    throw new Error(`GPU renderer must identify hardware; masked/known software renderer: ${renderer}`)
}
export function assertSampleCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 64 || count > 4096 || count % 64 !== 0)
    throw new Error('GPU sample count must be a multiple of 64 in [64, 4096]')
}

export function summarizeGpuSamples(samples: readonly GpuSample[], count: number) {
  assertSampleCount(count)
  if (samples.length !== count) throw new Error(`Incomplete GPU sample count: ${samples.length}/${count}`)
  const phases = Array.from({ length: 64 }, () => [] as number[])
  samples.forEach((sample, i) => {
    if (!Number.isSafeInteger(sample.frame) || sample.frame < 0 || !Number.isFinite(sample.ms) || sample.ms < 0)
      throw new Error('Invalid GPU sample')
    if (i > 0 && sample.frame !== samples[i - 1].frame + 1) throw new Error('GPU frames must be consecutive')
    phases[sample.frame % 64].push(sample.ms)
  })
  if (phases.some((phase) => phase.length !== count / 64)) throw new Error('GPU noise phases must be balanced')
  const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b)
  return {
    gpu: { count, mean: mean(sorted), p50: sorted[Math.floor(count * 0.5)], p95: sorted[Math.floor(count * 0.95)] },
    phases: phases.map((phase) => ({ count: phase.length, mean: mean(phase) }))
  }
}

export interface TimingOptions {
  gl: WebGL2RenderingContext
  owner: object
  method: string
  readFrame(): number
  count: number
  timeoutMs?: number
  nextFrame?: () => Promise<unknown>
}

/** Times only the hooked draw. Warmup, polling and readback sit outside queries. */
export async function collectGpuSamples({
  gl,
  owner,
  method,
  readFrame,
  count,
  timeoutMs = 180000,
  nextFrame = () => new Promise(requestAnimationFrame)
}: TimingOptions): Promise<{
  samples: GpuSample[]
  gpu: { count: number; mean: number; p50: number; p95: number }
  phases: Array<{ count: number; mean: number }>
}> {
  assertSampleCount(count)
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number
    GPU_DISJOINT_EXT: number
  } | null
  if (!ext) throw new Error('GPU timers unavailable (EXT_disjoint_timer_query_webgl2)')
  if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw new Error('GPU timer already active')
  const original: unknown = Reflect.get(owner, method)
  if (typeof original !== 'function') throw new Error(`GPU timing target missing: ${method}`)
  const descriptor = Object.getOwnPropertyDescriptor(owner, method)
  const pending: Array<{ query: WebGLQuery; frame: number }> = [],
    samples: GpuSample[] = []
  let active = false,
    submitted = 0,
    failure: unknown
  const deadline = performance.now() + timeoutMs
  const wait = async () => {
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw new Error('GPU sampling deadline exceeded')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        nextFrame(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('GPU sampling deadline exceeded')), remaining)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const poll = () => {
    if (failure) throw failure
    if (gl.isContextLost()) throw new Error('GPU context lost')
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw new Error('GPU disjoint: timings invalid')
    while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
      const entry = pending[0]
      samples.push({ frame: entry.frame, ms: gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6 })
      gl.deleteQuery(entry.query)
      pending.shift()
    }
  }
  const wrapped = function (this: unknown, ...args: unknown[]) {
    if (!active || submitted >= count || failure) return original.apply(this, args)
    let frame: number
    try {
      frame = readFrame()
    } catch (error) {
      failure = error
      throw error
    }
    const query = gl.createQuery()
    if (!query) {
      failure = new Error('GPU query allocation failed')
      throw failure
    }
    let begun = false
    try {
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
      begun = true
      submitted++
      return original.apply(this, args)
    } catch (error) {
      failure = error
      throw error
    } finally {
      if (begun) {
        gl.endQuery(ext.TIME_ELAPSED_EXT)
        pending.push({ query, frame })
      } else gl.deleteQuery(query)
    }
  }
  if (!Reflect.set(owner, method, wrapped)) throw new Error(`GPU timing target not writable: ${method}`)
  try {
    for (let i = 0; i < 64; i++) await wait()
    poll()
    active = true
    while (submitted < count) {
      await wait()
      poll()
    }
    active = false
    for (let i = 0; i < 120 && pending.length; i++) {
      await wait()
      poll()
    }
    if (pending.length) throw new Error('GPU query results did not become available')
    return { samples, ...summarizeGpuSamples(samples, count) }
  } finally {
    active = false
    if (descriptor) Object.defineProperty(owner, method, descriptor)
    else Reflect.deleteProperty(owner, method)
    for (const { query } of pending) gl.deleteQuery(query)
  }
}
