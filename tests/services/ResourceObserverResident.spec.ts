import { describe, it, expect, vi } from 'vitest'
import { Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { Resource } from '@/core/models/Resource'
import { Scenarios } from '@/config/scenarios'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { TextureRequest } from '@/core/textures/types'

describe('ResourceObserver: резидентные берутся из lifecycle', () => {
  it('грузит все резидентные ресурсы и ни одного стримируемого', async () => {
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
      new Scene()
    )

    observer.scenario = Scenarios[0]
    await observer.loadPrimaryTextures()

    const streamablePaths: string[] = Resource.all()
      .filter((resource: Resource): boolean => resource.getAttribute('lifecycle') === 'streamable')
      .map((resource: Resource): string => resource.getAttribute('path', ''))
      .toArray()

    // Ни один стримируемый путь не запрошен при старте сценария.
    expect(requested.filter((name: string): boolean => streamablePaths.includes(name))).toEqual([])

    // Одиночные резидентные запрошены поимённо; кубмапа идёт одним запросом
    // из шести граней под собственным именем, поэтому считается отдельно.
    expect(requested).toContain('default.png')
    expect(requested).toContain('planets/saturn/saturn_rings.png')
    expect(requested).toContain('cubemaps-scene-main')

    resourceStorage.deleteAllTextures()
  })
})
