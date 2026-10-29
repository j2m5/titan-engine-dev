import { expect, test } from 'vitest'
import { assertHardwareRenderer, collectGpuSamples, summarizeGpuSamples } from './benchmarkTiming'

test.each([
  null,
  '',
  'WebKit WebGL',
  'ANGLE (Google, SwiftShader Device)',
  'llvmpipe (LLVM 18)',
  'softpipe',
  'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)',
  'Microsoft WARP',
  'Mesa lavapipe'
])('hardware benchmark rejects masked/known software renderer %s', (renderer) => {
  expect(() => assertHardwareRenderer(renderer)).toThrow(/GPU renderer/)
})
test.each([
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti Direct3D11)',
  'ANGLE (AMD, AMD Radeon Graphics Direct3D11)',
  'ANGLE (Intel, Intel UHD Graphics Direct3D11)',
  'Apple M3'
])('hardware benchmark accepts identified GPU %s', (renderer) => {
  expect(() => assertHardwareRenderer(renderer)).not.toThrow()
})

const samples = () => Array.from({ length: 128 }, (_, i) => ({ frame: 100 + i, ms: i + 1 }))

test('GPU summary keeps a balanced full noise cycle and reports milliseconds', () => {
  expect(summarizeGpuSamples(samples(), 128)).toMatchObject({
    gpu: { count: 128, mean: 64.5, p50: 65, p95: 122 },
    phases: expect.arrayContaining([{ count: 2, mean: 33 }])
  })
})

// WebGL is external to unit tests. The fake enforces query lifetime/nesting and
// defers results until after a later RAF; the browser run checks actual GPU data.
function timerFixture(failure?: 'disjoint' | 'pending' | 'draw' | 'missing' | 'lost' | 'allocation') {
  const live = new Set<object>()
  let active: object | null = null,
    tick = 0,
    frame = 0,
    draws = 0,
    submitted = 0
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }
  const gl = {
    CURRENT_QUERY: 3,
    QUERY_RESULT_AVAILABLE: 4,
    QUERY_RESULT: 5,
    getExtension: () => (failure === 'missing' ? null : ext),
    isContextLost: () => failure === 'lost' && submitted > 2,
    getParameter: () => failure === 'disjoint' && submitted > 2,
    getQuery: () => active,
    createQuery() {
      if (failure === 'allocation') return null
      const q = { readyAt: tick + 2 }
      live.add(q)
      return q
    },
    beginQuery(_target: number, q: object) {
      if (active || !live.has(q)) throw new Error('Nested or deleted GPU query')
      active = q
      submitted++
    },
    endQuery() {
      active = null
    },
    deleteQuery(q: object) {
      live.delete(q)
    },
    getQueryParameter(q: { readyAt: number }, parameter: number) {
      if (!live.has(q)) throw new Error('Reading deleted query')
      return parameter === 4 ? failure !== 'pending' && tick >= q.readyAt : 2_000_000
    }
  } as unknown as WebGL2RenderingContext
  const owner = {
    render() {
      draws++
      if (active && failure === 'draw') throw new Error('Draw failed')
    }
  }
  const original = owner.render
  const options = {
    gl,
    owner,
    method: 'render',
    readFrame: () => frame,
    count: 128,
    timeoutMs: 1000,
    nextFrame: async () => {
      tick++
      frame++
      try {
        owner.render()
      } catch {
        /* Engine logs and continues. */
      }
    }
  }
  return { options, original, live, submitted: () => submitted, draws: () => draws }
}

test('GPU collection submits exactly the requested count and restores the render hook', async () => {
  const f = timerFixture()
  const result = await collectGpuSamples(f.options)
  expect(result.gpu).toEqual({ count: 128, mean: 2, p50: 2, p95: 2 })
  expect(result.phases.every((phase) => phase.count === 2)).toBe(true)
  expect(f.submitted()).toBe(128)
  expect(f.draws()).toBeGreaterThan(128) // warmup/drain render without extra queries
  expect(f.options.owner.render).toBe(f.original)
  expect(f.live.size).toBe(0)
})

test.each(['disjoint', 'pending', 'draw', 'missing', 'lost', 'allocation'] as const)(
  'GPU collection rejects %s data and releases its queries and hook',
  async (failure) => {
    const f = timerFixture(failure)
    await expect(collectGpuSamples(f.options)).rejects.toThrow(/GPU|Draw failed/)
    expect(f.options.owner.render).toBe(f.original)
    expect(f.live.size).toBe(0)
  }
)

test('a stalled RAF is bounded and restores the render hook', async () => {
  const f = timerFixture()
  await expect(
    collectGpuSamples({ ...f.options, timeoutMs: 20, nextFrame: () => new Promise(() => {}) })
  ).rejects.toThrow(/GPU.*deadline/)
  expect(f.options.owner.render).toBe(f.original)
  expect(f.live.size).toBe(0)
})

test('a changed scene fails immediately even when Engine catches the hook error', async () => {
  const f = timerFixture()
  await expect(
    collectGpuSamples({
      ...f.options,
      readFrame: () => {
        throw new Error('Scene changed')
      }
    })
  ).rejects.toThrow('Scene changed')
  expect(f.options.owner.render).toBe(f.original)
  expect(f.live.size).toBe(0)
})

test('GPU summary rejects incomplete, stale, skipped and nonfinite timings', () => {
  expect(() => summarizeGpuSamples(samples().slice(1), 128)).toThrow(/sample count/)
  for (const mutate of [
    (s: ReturnType<typeof samples>) => {
      s[12].frame = s[11].frame
    },
    (s: ReturnType<typeof samples>) => {
      s[12].frame += 64
    },
    (s: ReturnType<typeof samples>) => {
      s[12].ms = NaN
    },
    (s: ReturnType<typeof samples>) => {
      s[12].ms = -1
    },
    (s: ReturnType<typeof samples>) => {
      s[12].frame = 1.5
    }
  ]) {
    const s = samples()
    mutate(s)
    expect(() => summarizeGpuSamples(s, 128)).toThrow(/Invalid|consecutive|balanced/)
  }
  expect(() => summarizeGpuSamples(samples(), 65)).toThrow(/multiple of 64/)
})
