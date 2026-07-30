import { describe, it, expect, vi } from 'vitest'
import { Scene } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { IResource } from '@/core/models/types'

const TYPO_PATH = 'planets/typo.tga'

function makeObserver(
  load: TextureProvider['load'],
  dispatch: NotificationSink['dispatch']
): ResourceObserver {
  const sceneObserver = { subscribe: vi.fn() } as unknown as SceneObserver
  const textures = { load } as unknown as TextureProvider

  return new ResourceObserver(
    sceneObserver,
    textures,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch } as unknown as NotificationSink,
    new Scene()
  )
}

function resource(path: string, extra: Partial<IResource> = {}): IResource {
  return { id: 1, resourceType: 'diffuse', lifecycle: 'streamable', lifetime: 5000, path, ...extra } as IResource
}

describe('ResourceObserver — опечатка в расширении не вешает загрузку сценария', () => {
  // TextureProvider.load бросает, когда ни одна стратегия не подходит форме
  // запроса (см. TextureProvider.spec.ts: «нет подходящей стратегии — бросает,
  // а не маскирует заглушкой»). Это ошибка данных, а не сбой сети — но выше по
  // цепочке (loadInto → Promise.all → Application.run → EngineStore.setScenario)
  // ни один уровень не оборачивал вызов в try, поэтому отказ раньше улетал бы
  // наружу необработанным и приложение зависало бы на экране загрузки.
  it('resident: бросок TextureProvider не долетает наружу loadPrimaryTextures, дispatch получает уведомление', async () => {
    const dispatch = vi.fn()
    const load = vi.fn().mockRejectedValue(new Error('TextureProvider: нет стратегии для planets/typo.tga'))

    const observer = makeObserver(load, dispatch)

    observer.resident = [resource(TYPO_PATH)]

    await expect(observer.loadPrimaryTextures()).resolves.toBeUndefined()

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringContaining(TYPO_PATH) })
    )
  })

  it('кубмапа: бросок TextureProvider не долетает наружу loadPrimaryTextures, фон остаётся null', async () => {
    const dispatch = vi.fn()
    const load = vi.fn().mockRejectedValue(new Error('TextureProvider: нет стратегии для скукоженной кубмапы'))

    const observer = makeObserver(load, dispatch)

    observer.cube = [
      resource('cube/px.jpg'),
      resource('cube/nx.jpg'),
      resource('cube/py.jpg'),
      resource('cube/ny.jpg'),
      resource('cube/pz.jpg')
      // седьмой грани нет намеренно — ровно тот скукоженный список, который
      // по описанию бага молча топит фон.
    ]
    observer.resident = []

    await expect(observer.loadPrimaryTextures()).resolves.toBeUndefined()

    expect(observer.sceneBackground).toBeNull()
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })
})
