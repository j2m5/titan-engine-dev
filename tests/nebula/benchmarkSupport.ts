export type BenchmarkOptions = { rounds: number; warmup: number; samples: number }

export function benchmarkOptions(env: Record<string, string | undefined>): BenchmarkOptions {
  const integer = (name: string, fallback: number, maximum: number) => {
    const value = Number(env[name] ?? fallback)
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      throw new Error(`${name} must be an integer in [1, ${maximum}]`)
    }
    return value
  }
  return {
    rounds: integer('TITAN_NEBULA_ROUNDS', 3, 20),
    warmup: integer('TITAN_NEBULA_WARMUP', 24, 600),
    samples: integer('TITAN_NEBULA_SAMPLES', 60, 10000)
  }
}

export function summarizeGpuMs(samples: readonly number[]) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('GPU samples must be nonempty, finite and positive')
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const quantile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
  return { count: sorted.length, min: sorted[0], p50: quantile(0.5), p95: quantile(0.95), max: sorted[sorted.length - 1] }
}

/** Deterministic Fisher-Yates: case order varies between rounds, not between runs. */
export function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values]
  let state = seed >>> 0
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = Math.floor((state / 0x100000000) * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
