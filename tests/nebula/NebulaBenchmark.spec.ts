import { describe, expect, it } from 'vitest'
import { benchmarkOptions, summarizeGpuMs } from './benchmarkSupport'

describe('nebula benchmark reporting', () => {
  it('bounds configuration before expensive GPU work', () => {
    expect(benchmarkOptions({})).toEqual({ rounds: 3, warmup: 24, samples: 60 })
    expect(benchmarkOptions({ TITAN_NEBULA_ROUNDS: '1', TITAN_NEBULA_SAMPLES: '8' })).toEqual({ rounds: 1, warmup: 24, samples: 8 })
    for (const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '10001']) {
      expect(() => benchmarkOptions({ TITAN_NEBULA_SAMPLES: value })).toThrow('TITAN_NEBULA_SAMPLES')
    }
  })

  it('reports nearest-rank quantiles and retains all raw samples', () => {
    const samples = [3, 1, 100, 2, 4]
    expect(summarizeGpuMs(samples)).toEqual({ count: 5, min: 1, p50: 3, p95: 100, max: 100 })
    expect(samples).toEqual([3, 1, 100, 2, 4])
    expect(summarizeGpuMs([7])).toEqual({ count: 1, min: 7, p50: 7, p95: 7, max: 7 })
  })

  it.each([[], [NaN], [Infinity], [-1], [0]].map(values => ({ values })))('rejects empty or invalid samples $values', ({ values }) => {
    expect(() => summarizeGpuMs(values)).toThrow(/samples/i)
  })
})
