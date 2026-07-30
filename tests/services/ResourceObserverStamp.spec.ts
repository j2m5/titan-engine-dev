import { describe, it, expect, vi, afterEach, beforeAll, afterAll, type MockInstance } from 'vitest'
import { Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { IActorBoundResource, IResource } from '@/core/models/types'
import type { LoadResult, TextureRequest } from '@/core/textures/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'

const RESIDENT_PATH = 'stamp-parity/resident.jpg'
const DEFERRED_PATH = 'stamp-parity/deferred.jpg'
const FAILING_PATH = 'stamp-parity/failing.jpg'

/**
 * jsdom без node-canvas не умеет 2D-контекст (см. tests/textures/
 * PlaceholderTexture.spec.ts — тот же приём). PlaceholderTexture.get() без
 * стаба canvas.getContext('2d') упадёт на context.fillStyle.
 */
const stubCanvas = (): HTMLCanvasElement =>
  ({
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: '', fillRect: () => undefined })
  }) as unknown as HTMLCanvasElement

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
  let createElementSpy: MockInstance | null = null

  beforeAll(() => {
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas())
  })

  afterAll(() => {
    createElementSpy?.mockRestore()
  })

  // resourceStorage — модульный синглтон, и loadInto пишет в него напрямую
  // (resourceStorage.addTexture). Без очистки между тестами файла регистрация
  // из одного теста пережила бы в следующий и исказила бы проверки реестра.
  afterEach(() => {
    resourceStorage.deleteAllTextures()
  })

  // Старый TextureManager (путь required, ныне resident) штамп никогда не
  // писал — только ImageBitmapManager (отложенные). Правило перенесено в
  // loadInto: стамп условен на type === 'bitmap', регистрация в реестре — нет.
  // resident грузится через loadPrimaryTextures (type: default), отложенные —
  // через loadDeferredTextures (type: bitmap): это два разных публичных входа,
  // поэтому проверяются двумя вызовами, а не одним.
  it('resident (type: default) не получает штамп, отложенные (type: bitmap) получают', async () => {
    const residentTexture = new Texture()
    const deferredTexture = new Texture()

    // Разная текстура на каждый путь — иначе не различить, какой вызов какой.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = request.name === RESIDENT_PATH ? residentTexture : deferredTexture
      return Promise.resolve({ ok: true, texture })
    })

    const observer = makeObserver(load)

    observer.resident = [resource(RESIDENT_PATH)]

    await observer.loadPrimaryTextures()
    await observer.loadDeferredTextures([{ ...resource(DEFERRED_PATH), actorId: 1 } as IActorBoundResource])

    expect(residentTexture.userData.resource).toBeUndefined()
    expect(deferredTexture.userData.resource).toBeDefined()
  })

  // Закрепляет `if (!result.ok || !result.texture) return` в loadInto: провал
  // загрузки не должен регистрировать разделяемую заглушку в resourceStorage.
  // Иначе Application.teardown → resourceStorage.deleteAllTextures() освободил
  // бы её при первой же разборке сценария, и все материалы, смотрящие на
  // PlaceholderTexture.get(), остались бы на диспоузнутой текстуре навсегда.
  it('провал загрузки не регистрирует разделяемую заглушку в resourceStorage', async () => {
    const placeholder = PlaceholderTexture.get()

    const load = vi.fn(
      (): Promise<LoadResult> =>
        Promise.resolve({ ok: false, texture: placeholder, error: new Error('404: не найден ресурс') })
    )

    const observer = makeObserver(load)

    observer.resident = [resource(FAILING_PATH)]

    await observer.loadPrimaryTextures()

    expect(resourceStorage.textures.contains((texture) => texture === placeholder)).toBe(false)
  })
})
