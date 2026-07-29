import { describe, it, expect, vi } from 'vitest'
import { Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { IResource } from '@/core/models/types'
import type { LoadResult, TextureRequest } from '@/core/textures/types'

const REQUIRED_PATH = 'stamp-parity/required.jpg'
const MISC_PATH = 'stamp-parity/misc.jpg'

function makeObserver(load: TextureProvider['load']): ResourceObserver {
  const sceneObserver = { subscribe: vi.fn() } as unknown as SceneObserver
  const textures = { load } as unknown as TextureProvider

  return new ResourceObserver(
    sceneObserver,
    textures,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    new Scene()
  )
}

function resource(path: string, extra: Partial<IResource> = {}): IResource {
  return { id: 1, resourceType: 'diffuse', lifecycle: 'streamable', lifetime: 5000, path, ...extra } as IResource
}

describe('ResourceObserver — штамп userData.resource: паритет со старым поведением', () => {
  // Старый TextureManager (путь required) штамп никогда не писал — только
  // ImageBitmapManager (misc и отложенные). Правило перенесено в loadInto:
  // стамп условен на type === 'bitmap', регистрация в реестре — нет.
  it('required (type: default) не получает штамп, misc (type: bitmap) получает', async () => {
    const requiredTexture = new Texture()
    const miscTexture = new Texture()

    // Разная текстура на каждый путь — иначе не различить, какой вызов какой.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = request.name === REQUIRED_PATH ? requiredTexture : miscTexture
      return Promise.resolve({ ok: true, texture })
    })

    const observer = makeObserver(load)

    observer.required = [resource(REQUIRED_PATH)]
    observer.misc = [resource(MISC_PATH)]

    await observer.loadPrimaryTextures()

    expect(requiredTexture.userData.resource).toBeUndefined()
    expect(miscTexture.userData.resource).toBeDefined()
  })
})
