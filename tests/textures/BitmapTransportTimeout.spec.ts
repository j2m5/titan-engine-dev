import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadingManager } from 'three'
import { streaming } from '@/config/streaming'
import { BitmapTransport } from '@/core/textures/BitmapTransport'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function observe<T>(promise: Promise<T>) {
  const result = { settled: false, value: undefined as T | undefined, error: undefined as Error | undefined }
  const done = promise.then(value => { result.value = value }, error => { result.error = error })
    .then(() => { result.settled = true })
  return { result, done }
}

/** Real body consumption; only the external HTTP endpoint is replaced. */
function stalledFetch(stage: 'headers' | 'body') {
  const signals: AbortSignal[] = []
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    const signal = init.signal!
    signals.push(signal)
    const error = () => new DOMException('Network request aborted', 'AbortError')
    if (stage === 'headers') return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(error()), { once: true })
    })
    return Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([137, 80, 78, 71]))
        signal.addEventListener('abort', () => controller.error(error()), { once: true })
      }
    }), { status: 200 }))
  }))
  return signals
}

describe('BitmapTransport request deadline', () => {
  const originalTimeout = streaming.streaming.textureTimeoutMs
  beforeEach(() => {
    vi.useFakeTimers()
    streaming.streaming.textureTimeoutMs = 100
  })
  afterEach(() => {
    streaming.streaming.textureTimeoutMs = originalTimeout
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(['headers', 'body'] as const)('aborts stalled %s as a failure and balances loading once', async stage => {
    const signals = stalledFetch(stage)
    const manager = new LoadingManager()
    manager.setURLModifier(() => '/resolved.png')
    const errors = vi.fn(), completed = vi.fn()
    manager.onError = errors
    manager.onLoad = completed
    const caller = new AbortController()
    const { result, done } = observe(new BitmapTransport(manager).loadAsync('/original.png', caller.signal))

    await vi.advanceTimersByTimeAsync(99)
    expect(result.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(result.error?.name).toBe('TimeoutError')
    await done
    expect(result.error?.message).toContain('/resolved.png')
    expect(signals[0].aborted).toBe(true)
    expect(caller.signal.aborted).toBe(false)
    expect(errors).toHaveBeenCalledExactlyOnceWith('/resolved.png')
    expect(completed).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses one deadline through body and decode, and closes the late bitmap', async () => {
    const body = deferred<Blob>(), decode = deferred<ImageBitmap>()
    const decoded = { close: vi.fn() } as unknown as ImageBitmap
    const manager = new LoadingManager(), completed = vi.fn()
    manager.onLoad = completed
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: () => body.promise })))
    const create = vi.fn(() => decode.promise)
    vi.stubGlobal('createImageBitmap', create)
    const { result, done } = observe(new BitmapTransport(manager).loadAsync('/slow.png'))
    await vi.advanceTimersByTimeAsync(60)
    body.resolve(new Blob())
    await vi.advanceTimersByTimeAsync(0)
    expect(create).toHaveBeenCalledOnce()
    try {
      await vi.advanceTimersByTimeAsync(40)
      expect(result.error?.name).toBe('TimeoutError')
      expect(completed).toHaveBeenCalledOnce()
    } finally {
      decode.resolve(decoded)
      await vi.advanceTimersByTimeAsync(0)
      await done
    }
    expect(decoded.close).toHaveBeenCalledOnce()
    expect(completed).toHaveBeenCalledOnce()
  })

  it('settles caller cancellation during decode immediately and releases its late bitmap', async () => {
    const decode = deferred<ImageBitmap>()
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })))
    vi.stubGlobal('createImageBitmap', vi.fn(() => decode.promise))
    const manager = new LoadingManager(), errors = vi.fn()
    manager.onError = errors
    const caller = new AbortController()
    const { result, done } = observe(new BitmapTransport(manager).loadAsync('/cancel.png', caller.signal))
    await vi.advanceTimersByTimeAsync(0)
    caller.abort()
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(result.error?.name).toBe('AbortError')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      decode.resolve(bitmap)
      await vi.advanceTimersByTimeAsync(0)
      await done
    }
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(errors).not.toHaveBeenCalled()
  })

  it('does not cancel a later request sharing the caller signal when the first times out', async () => {
    const signals = stalledFetch('body')
    const caller = new AbortController(), transport = new BitmapTransport()
    const first = observe(transport.loadAsync('/first.png', caller.signal))
    await vi.advanceTimersByTimeAsync(50)
    const second = observe(transport.loadAsync('/second.png', caller.signal))
    await vi.advanceTimersByTimeAsync(50)
    expect(first.result.error?.name).toBe('TimeoutError')
    expect(second.result.settled).toBe(false)
    expect(signals.map(signal => signal.aborted)).toEqual([true, false])
    expect(caller.signal.aborted).toBe(false)
    caller.abort()
    await Promise.all([first.done, second.done])
    expect(second.result.error?.name).toBe('AbortError')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the deadline on success without closing the returned bitmap', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap
    const caller = new AbortController()
    let networkSignal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      networkSignal = init.signal
      return new Response(new Blob())
    }))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    expect(await new BitmapTransport().loadAsync('/ok.png', caller.signal)).toBe(bitmap)
    expect(vi.getTimerCount()).toBe(0)
    caller.abort()
    await vi.advanceTimersByTimeAsync(100)
    expect(networkSignal?.aborted).toBe(false)
    expect(bitmap.close).not.toHaveBeenCalled()
  })

  it('clears the deadline after an HTTP error without reporting a second failure', async () => {
    const manager = new LoadingManager(), errors = vi.fn(), completed = vi.fn()
    manager.onError = errors
    manager.onLoad = completed
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await expect(new BitmapTransport(manager).loadAsync('/missing.png')).rejects.toThrow('404')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(errors).toHaveBeenCalledOnce()
    expect(completed).toHaveBeenCalledOnce()
  })
})
