import { describe, it, expect, vi, afterEach, beforeAll, afterAll, type MockInstance } from 'vitest'
import { Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { IResource } from '@/core/models/types'
import type { LoadResult } from '@/core/textures/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'

const RESIDENT_PATH = 'stamp-parity/resident.jpg'
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
    new Scene(),
    new TextureBudget(1024 ** 3)
  )
}

function resource(path: string, extra: Partial<IResource> = {}): IResource {
  return { id: 1, resourceType: 'diffuse', lifecycle: 'streamable', path, ...extra } as IResource
}

/**
 * Раньше здесь проверялся штамп `userData.resource` (различие `default` и
 * `bitmap` по типу загрузки) — задача 5 удалила и штамп, и само различие
 * путей: единственный читатель штампа, `releaseUnusedTextures`, тоже удалён.
 * Инвариант, который штамп когда-то обслуживал непрямо, — не в разметке
 * текстуры, а в том, что происходит с реестром: удачная загрузка обязана в
 * нём оказаться, провалившаяся — не должна. Второй случай в файле уже был
 * (закреплял `if (!result.ok || !result.texture) return` в `loadInto`),
 * поэтому он сохранён как есть; добавлен только зеркальный успешный случай.
 */
describe('ResourceObserver — реестр после loadPrimaryTextures', () => {
  let createElementSpy: MockInstance | null = null

  beforeAll(() => {
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas())
  })

  afterAll(() => {
    createElementSpy?.mockRestore()
  })

  afterEach(() => {
    resourceStorage.deleteAllTextures()
  })

  it('удачная загрузка регистрируется в resourceStorage', async () => {
    const texture = new Texture()

    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true, texture }))

    const observer = makeObserver(load)

    observer.resident = [resource(RESIDENT_PATH)]

    await observer.loadPrimaryTextures()

    expect(resourceStorage.textures.contains((candidate) => candidate === texture)).toBe(true)
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
