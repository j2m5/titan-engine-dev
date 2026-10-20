import { describe, expect, it, vi } from 'vitest'
import { GpuTimer } from '../browser/gpuTimer'

function fixture() {
  const ext = { TIME_ELAPSED_EXT: 10, QUERY_COUNTER_BITS_EXT: 11, GPU_DISJOINT_EXT: 12 }
  const gl = {
    QUERY_RESULT_AVAILABLE: 20, QUERY_RESULT: 21,
    getExtension: vi.fn(() => ext), getQuery: vi.fn(() => 64),
    getParameter: vi.fn(() => false), isContextLost: vi.fn(() => false),
    createQuery: vi.fn(() => ({})), beginQuery: vi.fn(), endQuery: vi.fn(), deleteQuery: vi.fn(),
    getQueryParameter: vi.fn((_query: object, name: number): boolean | number => name === 20 ? false : 2_500_000)
  }
  return { gl, timer: () => new GpuTimer(gl as unknown as WebGL2RenderingContext) }
}

describe('native GPU timing', () => {
  it('requires elapsed timer support and nonzero counter precision', () => {
    const f = fixture()
    f.gl.getExtension.mockReturnValue(null as never)
    expect(f.timer).toThrow(/timer/i)
    const g = fixture()
    g.gl.getQuery.mockReturnValue(0)
    expect(g.timer).toThrow(/counter/i)
  })

  it('polls asynchronously, converts nanoseconds without truncation and releases queries', () => {
    const { gl, timer } = fixture(), t = timer(), draw = vi.fn()
    t.measure(draw)
    expect(draw).toHaveBeenCalledOnce()
    expect(t.pendingCount).toBe(1)
    expect(t.poll()).toEqual([])
    expect(gl.getQueryParameter).not.toHaveBeenCalledWith(expect.anything(), gl.QUERY_RESULT)
    gl.getQueryParameter.mockImplementation((_query, name) => name === 20 ? true : 5_000_000_000)
    expect(t.poll()).toEqual([5000])
    expect(t.pendingCount).toBe(0)
    expect(gl.deleteQuery).toHaveBeenCalledOnce()
    t.dispose()
    expect(gl.deleteQuery).toHaveBeenCalledOnce()
  })

  it.each(['disjoint', 'context lost'])('rejects %s and releases all outstanding queries', reason => {
    const { gl, timer } = fixture(), t = timer()
    t.measure(() => {})
    t.measure(() => {})
    if (reason === 'disjoint') gl.getParameter.mockReturnValue(true)
    else gl.isContextLost.mockReturnValue(true)
    expect(() => t.poll()).toThrow(/disjoint|context lost/i)
    expect(t.pendingCount).toBe(0)
    expect(gl.deleteQuery).toHaveBeenCalledTimes(2)
  })

  it('ends and releases the query when the measured draw throws', () => {
    const { gl, timer } = fixture(), t = timer()
    expect(() => t.measure(() => { throw new Error('draw failed') })).toThrow('draw failed')
    expect(gl.endQuery).toHaveBeenCalledOnce()
    expect(gl.deleteQuery).toHaveBeenCalledOnce()
    expect(t.pendingCount).toBe(0)
  })

  it.each([NaN, Infinity, -1, 0])('rejects invalid GPU duration %s', value => {
    const { gl, timer } = fixture(), t = timer()
    t.measure(() => {})
    gl.getQueryParameter.mockImplementation((_query, name) => name === 20 ? true : value)
    expect(() => t.poll()).toThrow(/duration/i)
    expect(gl.deleteQuery).toHaveBeenCalledOnce()
  })

  it('releases pending handles on early termination', () => {
    const { gl, timer } = fixture(), t = timer()
    t.measure(() => {})
    t.dispose()
    t.dispose()
    expect(gl.deleteQuery).toHaveBeenCalledOnce()
    expect(t.pendingCount).toBe(0)
  })
})
