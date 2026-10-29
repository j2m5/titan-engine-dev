import { describe, expect, it, vi } from 'vitest'
import type { WebGLRenderer } from 'three'
import type { SceneCloudReceiver } from '@/core/clouds/receivers/SceneCloudReceiver'
import { CloudCompilationFailures } from '@/core/clouds/scene/cloudCompilationFailure'
import { captureShaderCompilation } from '@/core/graphic/effects/atmosphere/shaderCompilationScope'
import { bindResourceStorageContext } from '@/core/services/ResourceStorage'

describe('cloud compilation failure boundary', () => {
  it('consumes only an observed restoration, across reconstruction and owner release/rebind, without reviving old failures', () => {
    const canvas = document.createElement('canvas'),
      renderer = {
        domElement: canvas,
        getContext: () => ({ isContextLost: () => false })
      } as unknown as WebGLRenderer
    const owner = { invalidateTextureGpuHandles() {} }
    let release = bindResourceStorageContext(renderer, owner)
    const first = new CloudCompilationFailures(),
      cause = Error('old context')
    first.bind(renderer)
    first.record(cause, { stage: 'depth', recovery: 'context' }, 'old')
    try {
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      expect(first.retry('unpaired', [])).toBe(false)
      canvas.dispatchEvent(new Event('webglcontextlost'))
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      release()
      release = bindResourceStorageContext(renderer, owner)
      const next = new CloudCompilationFailures()
      next.bind(renderer)
      expect(next.current).toBeNull()
      expect(first.current).toBeNull()
      first.bind(renderer)
      expect(first.current).toBeNull()
      const freshCause = Error('new context failure')
      next.record(freshCause, { stage: 'near', recovery: 'context' }, 'new')
      expect(first.current?.cause).toBe(freshCause)
      release()
      release = bindResourceStorageContext(renderer, owner)
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      expect(next.retry('rebound/unpaired', [])).toBe(false)
      canvas.dispatchEvent(new Event('webglcontextlost'))
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      expect(next.current).toBeNull()
      expect(first.current).toBeNull()
    } finally {
      release()
    }
  })
  it('classifies a nested diagnostic from the previous handler as context-only, preserving first attribution', () => {
    const receiver = { retryEndpointMaterial: vi.fn() } as unknown as SceneCloudReceiver,
      failures = new CloudCompilationFailures(),
      seen: boolean[] = []
    const renderer = {
      debug: { onShaderError: null as WebGLRenderer['debug']['onShaderError'], checkShaderErrors: false }
    }
    const gl = { getProgramInfoLog: () => 'first program', getShaderInfoLog: () => '' }
    const invoke = () => renderer.debug.onShaderError!(gl as never, {} as never, {} as never, {} as never)
    let nested = false
    const previous: NonNullable<WebGLRenderer['debug']['onShaderError']> = () => {
      if (!nested) {
        nested = true
        invoke()
      }
    }
    renderer.debug.onShaderError = previous
    const cause = Error('first owned program')
    const scope = captureShaderCompilation(renderer as never, 'nested', (reentrant) => {
      seen.push(reentrant)
      failures.record(
        cause,
        { stage: 'near', recovery: reentrant ? 'context' : 'owned-near', receivers: [receiver] },
        'failed'
      )
    })
    invoke()
    expect(seen).toEqual([false, true])
    expect(failures.current?.cause).toBe(cause)
    expect(failures.current?.recovery).toBe('context')
    expect(failures.retry('changed', [receiver])).toBe(false)
    scope.restore()
    expect(renderer.debug.onShaderError).toBe(previous)
  })
  it('snapshots failure attribution before the previous handler can run nested work', () => {
    let marker = 'unknown',
      captured = ''
    const previous = vi.fn(() => {
      marker = 'owned'
      throw Error('previous callback')
    })
    const renderer = { debug: { onShaderError: previous, checkShaderErrors: false } }
    const scope = captureShaderCompilation(renderer as never, 'test', () => {
      captured = marker
    })
    const callback = renderer.debug.onShaderError as unknown as NonNullable<WebGLRenderer['debug']['onShaderError']>
    callback(
      { getProgramInfoLog: () => '', getShaderInfoLog: () => '' } as never,
      {} as never,
      {} as never,
      {} as never
    )
    expect(captured).toBe('unknown')
    expect(() => scope.check()).toThrow('previous callback')
    scope.restore()
    expect(renderer.debug.onShaderError).toBe(previous)
  })
  it('keeps unknown/depth evidence across unrelated keys and runtime reconstruction until loss then restore', () => {
    const renderer = {} as never,
      first = new CloudCompilationFailures(),
      cause = Error('depth')
    first.bind(renderer)
    first.record(cause, { stage: 'depth', recovery: 'context' }, 'old')
    for (const token of ['source', 'quality', 'layout', 'scenario', 'lut']) expect(first.retry(token, [])).toBe(false)
    const next = new CloudCompilationFailures()
    next.bind(renderer)
    expect(next.current?.cause).toBe(cause)
    next.restored()
    expect(next.retry('new', [])).toBe(false)
    next.lost()
    next.restored()
    expect(next.retry('new', [])).toBe(true)
  })
  it('retries an exact still-live owned near receiver once at a deliberate boundary', () => {
    const receiver = { retryEndpointMaterial: vi.fn() } as unknown as SceneCloudReceiver,
      failures = new CloudCompilationFailures()
    failures.record(Error('owned near'), { stage: 'near', recovery: 'owned-near', receivers: [receiver] }, 'same')
    expect(failures.retry('same', [receiver])).toBe(false)
    expect(failures.retry('changed', [receiver])).toBe(true)
    expect(failures.retry('changed', [receiver])).toBe(true)
    expect(receiver.retryEndpointMaterial).toHaveBeenCalledOnce()
  })
  it('retires every owned variant in the participating scope, including another retained failed-cache owner', () => {
    const a = { retryEndpointMaterial: vi.fn() } as unknown as SceneCloudReceiver,
      b = { retryEndpointMaterial: vi.fn() } as unknown as SceneCloudReceiver,
      failures = new CloudCompilationFailures()
    failures.record(
      Error('one shared program callback'),
      { stage: 'near', recovery: 'owned-near', receivers: [a, b] },
      'failed'
    )
    expect(failures.retry('retry', [a, b])).toBe(true)
    expect(a.retryEndpointMaterial).toHaveBeenCalledOnce()
    expect(b.retryEndpointMaterial).toHaveBeenCalledOnce()
    expect(failures.retry('retry', [a, b])).toBe(true)
    expect(b.retryEndpointMaterial).toHaveBeenCalledOnce()
  })
  it('unknown dominates mixed failures and preserves the original diagnostic cause', () => {
    const receiver = { retryEndpointMaterial: vi.fn() } as unknown as SceneCloudReceiver,
      failures = new CloudCompilationFailures(),
      cause = Error('first')
    failures.record(cause, { stage: 'near', recovery: 'owned-near', receivers: [receiver] }, 'same')
    failures.record(Error('unknown'), { stage: 'near', recovery: 'context' }, 'same')
    expect(failures.current?.cause).toBe(cause)
    expect(failures.retry('changed', [receiver])).toBe(false)
    expect(failures.current?.receivers).toBeUndefined()
    expect(receiver.retryEndpointMaterial).not.toHaveBeenCalled()
  })
  it('never invokes a receiver removed or disposed before retry', () => {
    const receiver = { retryEndpointMaterial: vi.fn() } as unknown as SceneCloudReceiver,
      failures = new CloudCompilationFailures()
    failures.record(Error('near'), { stage: 'near', recovery: 'owned-near', receivers: [receiver] }, 'same')
    expect(failures.retry('changed', [])).toBe(false)
    expect(failures.current?.recovery).toBe('context')
    expect(receiver.retryEndpointMaterial).not.toHaveBeenCalled()
  })
})
