import { afterEach, describe, expect, it, vi } from 'vitest'
import { CubeTexture, DefaultLoadingManager, Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import { Resource } from '@/core/models/Resource'
import { Scenarios } from '@/config/scenarios'
import type { IResource } from '@/core/models/types'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadResult, TextureRequest } from '@/core/textures/types'

function deferred<T>() {
  let resolve!: (result: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fixture(load: (request: TextureRequest) => Promise<LoadResult>) {
  const progress = { setAsset: vi.fn(), setTotal: vi.fn(), setProgress: vi.fn() }
  const notifications = { dispatch: vi.fn() }
  const observer = new ResourceObserver(
    { subscribe: vi.fn() } as unknown as SceneObserver,
    { load } as unknown as TextureProvider,
    progress, notifications, new Scene(), new TextureBudget(1024 ** 3)
  )
  observer.scenario = Scenarios[0]
  observer.cube = []
  observer.resident = observer.resident.slice(0, 1)
  return { observer, progress, notifications }
}

describe('ResourceObserver primary cancellation', () => {
  const originalOnError = DefaultLoadingManager.onError
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    DefaultLoadingManager.onError = originalOnError
  })

  it('attributes manager failures to their request when scenarios A and B overlap', async () => {
    const old = deferred<LoadResult>()
    const live = deferred<LoadResult>()
    const requests: TextureRequest[] = []
    const { observer, notifications } = fixture((request) => {
      requests.push(request)
      return requests.length === 1 ? old.promise : live.promise
    })
    const oldRun = observer.loadPrimaryTextures()
    const residents = observer.resident
    observer.scenario = Scenarios[1]
    observer.cube = []
    observer.resident = residents
    const liveRun = observer.loadPrimaryTextures()

    // Three loaders look up the manager's CURRENT onError, not its value at request start.
    DefaultLoadingManager.itemError(requests[0].paths[0])
    old.resolve({ ok: false, texture: null, error: new Error('old network failure') })
    await oldRun
    expect(notifications.dispatch).not.toHaveBeenCalled()

    DefaultLoadingManager.itemError(requests[1].paths[0])
    live.resolve({ ok: false, texture: null, error: new Error('current network failure') })
    await liveRun
    expect(notifications.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'error',
      message: `The error occurred while loading: ${requests[1].name} (current network failure)`
    })
  })

  it('disposes a late resident without registering it or clearing newer progress', async () => {
    const old = deferred<LoadResult>()
    const live = deferred<LoadResult>()
    let calls = 0
    const { observer, progress } = fixture(() => ++calls === 1 ? old.promise : live.promise)
    const oldRun = observer.loadPrimaryTextures()
    const resources = observer.resident
    observer.scenario = Scenarios[1]
    observer.cube = []
    observer.resident = resources
    const liveRun = observer.loadPrimaryTextures()
    const texture = new Texture()
    texture.name = resources[0].path
    live.resolve({ ok: true, texture })
    await liveRun
    const assetCount = progress.setAsset.mock.calls.length
    const progressCount = progress.setProgress.mock.calls.length
    const staleTexture = new Texture()
    staleTexture.name = texture.name
    const dispose = vi.spyOn(staleTexture, 'dispose')
    old.resolve({ ok: true, texture: staleTexture })
    await oldRun
    expect(dispose).toHaveBeenCalledOnce()
    expect(resourceStorage.getTexture(texture.name)).toBe(texture)
    expect(resourceStorage.getCountTextures()).toBe(1)
    expect(progress.setAsset).toHaveBeenCalledTimes(assetCount)
    expect(progress.setProgress).toHaveBeenCalledTimes(progressCount)
  })

  it('keeps cube B when cancelled cube A arrives and never starts A residents', async () => {
    const old = deferred<LoadResult>()
    const live = deferred<LoadResult>()
    const requests: TextureRequest[] = []
    const { observer, progress } = fixture((request) => {
      requests.push(request)
      return requests.length === 1 ? old.promise : live.promise
    })
    const cube = Resource.query().where({ resourceType: 'cube' }).get().toJSON().slice(0, 6) as IResource[]
    observer.cube = cube
    const oldRun = observer.loadPrimaryTextures()
    observer.scenario = Scenarios[1]
    observer.cube = cube
    observer.resident = []
    const liveRun = observer.loadPrimaryTextures()
    const backgroundB = new CubeTexture()
    backgroundB.name = requests[1].name
    live.resolve({ ok: true, texture: backgroundB })
    await liveRun
    // Changing the public array must not change the old operation's snapshot.
    observer.resident = [Resource.all().first()!.toJSON() as IResource]
    const assetCount = progress.setAsset.mock.calls.length
    const staleCube = new CubeTexture()
    staleCube.name = backgroundB.name
    const dispose = vi.spyOn(staleCube, 'dispose')
    old.resolve({ ok: true, texture: staleCube })
    await oldRun
    expect(dispose).toHaveBeenCalledOnce()
    expect(observer.sceneBackground).toBe(backgroundB)
    expect(resourceStorage.getTexture(backgroundB.name)).toBe(backgroundB)
    expect(requests).toHaveLength(2)
    expect(progress.setAsset).toHaveBeenCalledTimes(assetCount)
  })

  it('suppresses a rejected stale operation notification', async () => {
    const old = deferred<LoadResult>()
    const { observer, notifications, progress } = fixture(() => old.promise)
    const run = observer.loadPrimaryTextures()
    observer.scenario = null
    const progressCount = progress.setProgress.mock.calls.length
    old.reject(new Error('late configuration failure'))
    await run
    expect(notifications.dispatch).not.toHaveBeenCalled()
    expect(progress.setProgress).toHaveBeenCalledTimes(progressCount)
  })

  it('does not dispose a failed stale result containing a shared fallback', async () => {
    const old = deferred<LoadResult>()
    const { observer } = fixture(() => old.promise)
    const run = observer.loadPrimaryTextures()
    observer.scenario = null
    const fallback = new Texture()
    const dispose = vi.spyOn(fallback, 'dispose')
    old.resolve({ ok: false, texture: fallback, error: new Error('404') })
    await run
    expect(dispose).not.toHaveBeenCalled()
    expect(resourceStorage.getCountTextures()).toBe(0)
  })
})
