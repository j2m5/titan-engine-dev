import { describe, it, expect, vi } from 'vitest'
import { Scene } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { Scenarios } from '@/config/scenarios'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { IActorBoundResource } from '@/core/models/types'

function makeObserver(): ResourceObserver {
  const sceneObserver = { subscribe: vi.fn() } as unknown as SceneObserver

  return new ResourceObserver(
    sceneObserver,
    { load: vi.fn(() => Promise.resolve({ ok: false, texture: null, error: new Error('stub') })) } as unknown as TextureProvider,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    new Scene()
  )
}

describe('ResourceObserver — смена сценария сбрасывает накопленное', () => {
  it('очищает список отложенных ресурсов', () => {
    const observer = makeObserver()

    observer.scenario = Scenarios[0]
    observer.deferred.push({ id: 1, path: 'planets/earth.jpg' } as IActorBoundResource)

    observer.scenario = Scenarios[1]

    expect(observer.deferred).toHaveLength(0)
  })

  it('не копит акторов в карте сценария', () => {
    const observer = makeObserver()

    observer.scenario = Scenarios[0]
    const first: number = observer.map.size

    observer.scenario = Scenarios[1]
    observer.scenario = Scenarios[0]

    expect(observer.map.size).toBe(first)
  })

  it('выход в меню очищает всё', () => {
    const observer = makeObserver()

    observer.scenario = Scenarios[0]
    observer.deferred.push({ id: 1, path: 'planets/earth.jpg' } as IActorBoundResource)

    observer.scenario = null

    expect(observer.deferred).toHaveLength(0)
    expect(observer.map.size).toBe(0)
  })
})
