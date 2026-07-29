import { describe, it, expect, vi, afterEach, beforeAll, afterAll, type MockInstance } from 'vitest'
import { Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { IResource } from '@/core/models/types'
import type { LoadResult, TextureRequest } from '@/core/textures/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'

const REQUIRED_PATH = 'stamp-parity/required.jpg'
const MISC_PATH = 'stamp-parity/misc.jpg'
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

    observer.required = [resource(FAILING_PATH)]
    observer.misc = []

    await observer.loadPrimaryTextures()

    expect(resourceStorage.textures.contains((texture) => texture === placeholder)).toBe(false)
  })
})
