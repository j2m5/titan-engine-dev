import { describe, it, expect, vi } from 'vitest'
import { Mesh, Scene, Texture, Vector3 } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'
import { Scenarios } from '@/config/scenarios'
import type { SceneObserver, ObservableRecord } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { TextureRequest, LoadResult } from '@/core/textures/types'
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
    new Scene(),
    new TextureBudget(1024 ** 3)
  )
}

function resource(path: string, extra: Partial<IResource> = {}): IResource {
  return { id: 1, resourceType: 'diffuse', lifecycle: 'streamable', path, ...extra } as IResource
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

const SOLAR_SYSTEM = Scenarios.find((s) => s.rootId === 1)!
const SIZE_8K: number = textureBytes(8192, 4096)

function record(name: string, distance: number): ObservableRecord {
  return { name, distance, position: new Vector3() }
}

function makeTexture(): Texture {
  const texture: Texture = new Texture()
  texture.image = { width: 2048, height: 1024 }
  return texture
}

/**
 * Учёт стриминга наблюдателя ключуется путём (задача 2) — приведение типа,
 * тот же приём, что и в соседних спеках.
 */
function streamingState(observer: ResourceObserver): { loaded: Set<string>; attempted: Set<string> } {
  return observer as unknown as { loaded: Set<string>; attempted: Set<string> }
}

function makeClosestChangeObserver(
  budgetBytes: number,
  load: TextureProvider['load']
): {
  observer: ResourceObserver
  handlers: Record<string, (event: ObservableRecord) => Promise<void>>
  data: Map<string, ObservableRecord>
  scene: Scene
} {
  const handlers: Record<string, (event: ObservableRecord) => Promise<void>> = {}
  const data: Map<string, ObservableRecord> = new Map()

  const sceneObserver = {
    subscribe: vi.fn((event: string, handler: (e: ObservableRecord) => Promise<void>): void => {
      handlers[event] = handler
    }),
    data
  } as unknown as SceneObserver

  const textures = { load } as unknown as TextureProvider
  const scene = new Scene()

  const observer = new ResourceObserver(
    sceneObserver,
    textures,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    scene,
    new TextureBudget(budgetBytes)
  )

  return { observer, handlers, data, scene }
}

/**
 * Провал по-разному бьёт по значимости пути (интерфейс задачи 2, brief §
 * loadPath): диффуз (ранг 0) без текстуры нечего показывать — материал уходит
 * на заглушку. Любая другая карта (здесь — bump Меркурия) необязательна: тело
 * переживает частичный набор, материал просто пересобирается без неё.
 *
 * Оба пути одного тела теперь независимые кандидаты (задача 2 грузит их
 * конкурентно) — провал одного не откатывает другой. Это и есть перевёрнутое
 * поведение относительно актор-центричной версии: там частичный провал
 * откатывал АКТОРА ЦЕЛИКОМ (см. старый докблок `loadActor`, git-история).
 */
describe('ResourceObserver — провал по значимости пути (диффуз против второстепенной карты)', () => {
  it('провал диффуза → resetMaterial (плейсхолдер), путь уходит в attempted', async () => {
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      if (request.name === 'planets/mercury/mercury.jpg') {
        return Promise.resolve({ ok: false as const, texture: null, error: new Error('404') })
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data, scene } = makeClosestChangeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    const mesh = new Mesh()
    mesh.name = 'Mercury'
    const material = { resetMaterial: vi.fn(), updateMaterial: vi.fn() }
    Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
    scene.add(mesh)

    data.set('Mercury', record('Mercury', 300))
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(material.resetMaterial).toHaveBeenCalled()

    const state = streamingState(observer)

    expect(state.attempted.has('planets/mercury/mercury.jpg')).toBe(true)
    expect(state.loaded.has('planets/mercury/mercury.jpg')).toBe(false)
  })

  it('провал второстепенной карты (bump) → updateMaterial, тело живёт своим диффузом', async () => {
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      if (request.name === 'planets/mercury/mercury_bump.jpg') {
        return Promise.resolve({ ok: false as const, texture: null, error: new Error('404') })
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data, scene } = makeClosestChangeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    const mesh = new Mesh()
    mesh.name = 'Mercury'
    const material = { resetMaterial: vi.fn(), updateMaterial: vi.fn() }
    Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
    scene.add(mesh)

    data.set('Mercury', record('Mercury', 300))
    await handlers['ClosestChange'](record('Mercury', 300))

    // Тело живёт: резета на заглушку не было, диффуз успешно загружен и
    // резидентен, только bump ушёл в attempted.
    expect(material.resetMaterial).not.toHaveBeenCalled()
    expect(material.updateMaterial).toHaveBeenCalled()

    const state = streamingState(observer)

    expect(state.loaded.has('planets/mercury/mercury.jpg')).toBe(true)
    expect(state.attempted.has('planets/mercury/mercury_bump.jpg')).toBe(true)
    expect(state.loaded.has('planets/mercury/mercury_bump.jpg')).toBe(false)
  })
})
