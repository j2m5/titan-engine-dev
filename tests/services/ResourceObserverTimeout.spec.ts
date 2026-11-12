import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Scene, type WebGLRenderer } from 'three'
import { streaming } from '@/config/streaming'
import { Scenarios } from '@/config/scenarios'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { TextureProvider } from '@/core/textures/TextureProvider'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import type { MapCandidate } from '@/core/streaming/types'
import type { IResource } from '@/core/models/types'
import type { SceneObserver } from '@/core/services/SceneObserver'

const resource = (path: string, resourceType: IResource['resourceType'] = 'diffuse'): IResource => ({
  id: -1, path, resourceType, lifecycle: 'resident'
})

function fixture() {
  const progress = { setTotal: vi.fn(), setProgress: vi.fn(), setAsset: vi.fn() }
  const notifications = { dispatch: vi.fn() }
  const renderer = { initTexture: vi.fn(), capabilities: { getMaxAnisotropy: () => 1 } }
  const observer = new ResourceObserver(
    { subscribe: vi.fn() } as unknown as SceneObserver,
    new TextureProvider(renderer as unknown as WebGLRenderer),
    progress, notifications, new Scene(), new TextureBudget(1024 ** 3)
  )
  observer.scenario = Scenarios[0]
  observer.cube = []
  observer.resident = [resource('held.png')]
  const signals: AbortSignal[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/ready.png')) return new Response(new Blob())
    const signal = init.signal!
    signals.push(signal)
    return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
    } }))
  }))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2, height: 2, close: vi.fn() })))
  return { observer, progress, notifications, signals, renderer }
}

describe('ResourceObserver transport timeout integration', () => {
  const originalTimeout = streaming.streaming.textureTimeoutMs
  beforeEach(() => {
    vi.useFakeTimers()
    streaming.streaming.textureTimeoutMs = 100
    // Only the browser canvas boundary is replaced; provider, strategies and storage are real.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({ fillStyle: '', fillRect() {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext
    )
  })
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    streaming.streaming.textureTimeoutMs = originalTimeout
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(['resident', 'cube'] as const)('finishes initial progress after stalled %s loading', async kind => {
    const { observer, progress, notifications, signals, renderer } = fixture()
    if (kind === 'cube') {
      observer.cube = Array.from({ length: 6 }, (_, face) => resource(`cube/${face}.png`, 'cube'))
      observer.resident = [resource('ready.png')]
    }
    let settled = false
    const pending = observer.loadPrimaryTextures().then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(100)
    expect(settled).toBe(true)
    await pending
    expect(progress.setProgress).toHaveBeenLastCalledWith(kind === 'cube' ? 7 : 1)
    expect(progress.setAsset).toHaveBeenLastCalledWith('')
    expect(signals).toHaveLength(kind === 'cube' ? 6 : 1)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(notifications.dispatch).toHaveBeenCalledOnce()
    expect(notifications.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('timed out') }))
    expect(observer.sceneBackground).toBeNull()
    expect(resourceStorage.getCountTextures()).toBe(kind === 'cube' ? 1 : 0)
    expect(renderer.initTexture).toHaveBeenCalledTimes(kind === 'cube' ? 1 : 0)
    observer.scenario = null
  })

  it('releases a stalled streaming reservation into the existing failure backoff', async () => {
    const { observer, notifications } = fixture()
    const state = observer as unknown as {
      loadPath(candidate: MapCandidate): Promise<void>
      inFlight: Set<string>
      loaded: Set<string>
      pathLoads: Map<string, unknown>
      attempted: Map<string, number>
    }
    const path = 'planets/mercury/mercury.jpg'
    const pending = state.loadPath({ actorId: 1, name: 'Mercury', path, typeRank: 0, actorPriority: 1 })
    expect(state.inFlight.has(path)).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(state.inFlight.has(path)).toBe(false)
    await pending
    expect(state.pathLoads.has(path)).toBe(false)
    expect(state.loaded.has(path)).toBe(false)
    expect(state.attempted.get(path)).toBe(Date.now())
    expect(resourceStorage.getTexture(path)).toBeUndefined()
    expect(notifications.dispatch).toHaveBeenCalledOnce()
    observer.scenario = null
  })
})
