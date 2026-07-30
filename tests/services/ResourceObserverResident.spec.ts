import { describe, it, expect, vi } from 'vitest'
import { Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import { Resource } from '@/core/models/Resource'
import { Scenarios } from '@/config/scenarios'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { TextureRequest } from '@/core/textures/types'

describe('ResourceObserver: резидентные берутся из lifecycle', () => {
  it('запрашивает ровно те одиночные ресурсы, у которых lifecycle === resident — не больше и не меньше', async () => {
    const requested: string[] = []
    const textures = {
      load: vi.fn((request: TextureRequest) => {
        requested.push(request.name)

        return Promise.resolve({ ok: true as const, texture: new Texture() })
      })
    } as unknown as TextureProvider

    const observer = new ResourceObserver(
      { subscribe: vi.fn() } as unknown as SceneObserver,
      textures,
      { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
      { dispatch: vi.fn() } as unknown as NotificationSink,
      new Scene(),
      new TextureBudget(1024 ** 3)
    )

    observer.scenario = Scenarios[0]
    await observer.loadPrimaryTextures()

    // Эталон читается из данных В МОМЕНТ ПРОВЕРКИ, а не захардкожен списком —
    // тест обязан следить за флагом lifecycle, а не фиксировать текущий снимок
    // путей. Кубмапа исключена намеренно: ей нужен отдельный запрос формы из
    // шести граней (см. ниже), поэтому в поэлементное сравнение она не входит.
    const residentSinglePaths: string[] = Resource.all()
      .filter(
        (resource: Resource): boolean =>
          resource.getAttribute('lifecycle') === 'resident' && resource.getAttribute('resourceType') !== 'cube'
      )
      .map((resource: Resource): string => resource.getAttribute('path', ''))
      .toArray()

    const cubeName = 'cubemaps-scene-main'
    const requestedSingles: string[] = requested.filter((name: string): boolean => name !== cubeName)

    // Точное соответствие в обе стороны, отсортированное (а не Set): ничего
    // резидентного не потеряно, ничего лишнего (стримируемого, дублирующего)
    // не запрошено. Sort ловит и повторный запрос одного и того же пути, где
    // сравнение множеств смолчало бы.
    expect(requestedSingles.slice().sort()).toEqual(residentSinglePaths.slice().sort())

    // Кубмапа собирается отдельным путём — шесть граней одним запросом под
    // собственным именем, проверяется по факту обращения, а не поэлементно.
    expect(requested).toContain(cubeName)

    resourceStorage.deleteAllTextures()
  })
})
