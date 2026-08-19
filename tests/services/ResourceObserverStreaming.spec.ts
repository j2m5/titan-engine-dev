import { describe, it, expect, vi } from 'vitest'
import { Mesh, Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'
import { MAP_TYPE_RANK } from '@/core/streaming/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { SceneObserver, ObservableRecord } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'

/** Собирает наблюдателя с подконтрольным SceneObserver и щедрым бюджетом. */
function makeObserver(budgetBytes: number = textureBytes(8192, 4096) * 8) {
  const handlers: Record<string, (event: ObservableRecord) => Promise<void>> = {}
  const data: Map<string, ObservableRecord> = new Map()

  const sceneObserver = {
    subscribe: vi.fn((event: string, handler: (e: ObservableRecord) => Promise<void>): void => {
      handlers[event] = handler
    }),
    data
  } as unknown as SceneObserver

  const loaded: string[] = []
  const textures = {
    load: vi.fn(() => {
      const texture = new Texture()
      texture.image = { width: 2048, height: 1024 }

      return Promise.resolve({ ok: true as const, texture })
    })
  } as unknown as TextureProvider

  const scene = new Scene()
  const budget = new TextureBudget(budgetBytes)
  const observer = new ResourceObserver(
    sceneObserver,
    textures,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    scene,
    budget
  )

  return { observer, handlers, data, scene, textures, loaded, budget }
}

describe('ResourceObserver: стриминг', () => {
  it('подписывается на ClosestChange', () => {
    const { handlers } = makeObserver()

    expect(typeof handlers['ClosestChange']).toBe('function')
  })

  it('порядок при вытеснении: текстура покидает реестр ДО переключения материалов', async () => {
    // Порядок обратный прежнему, и обоснование прежнего было ложным: между
    // двумя шагами синхронного метода кадр не рисуется, так что «кадр между
    // шагами рисуется освобождённой текстурой» не могло происходить. Зато
    // updateMaterial перечитывает тот же реестр — пока путь в нём, материал
    // находит текстуру снова, и переключение идёт вхолостую (см. соседний тест
    // про второстепенную карту). resetMaterial от реестра не зависит вовсе
    // (садится на 'default.png'), поэтому диффузу новый порядок безразличен.
    const order: string[] = []
    const { observer, scene } = makeObserver()

    const mesh = new Mesh()
    mesh.name = 'Earth'
    const material = { resetMaterial: (): void => void order.push('reset'), updateMaterial: vi.fn() }
    Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
    scene.add(mesh)

    const texture = new Texture()
    texture.name = 'planets/earth.jpg'
    resourceStorage.addTexture(texture)
    vi.spyOn(resourceStorage, 'deleteTexture').mockImplementation((): void => void order.push('delete'))

    // typeRank = diffuse: только диффуз откатывается на заглушку целиком —
    // это и проверяет тест (resetMaterial, а не updateMaterial).
    observer.evictPath({ actorId: 1, name: 'Earth', path: 'planets/earth.jpg', typeRank: MAP_TYPE_RANK.diffuse, actorPriority: 0 })

    expect(order).toEqual(['delete', 'reset'])

    vi.restoreAllMocks()
    resourceStorage.deleteAllTextures()
  })

  it('вытеснение второстепенной карты: к моменту updateMaterial путь уже вне реестра', () => {
    // Ветка updateMaterial (не-диффуз) не была покрыта ни одним тестом, а
    // именно в ней жил дефект: материал перечитывает resourceStorage, и пока
    // текстура там, он находит её снова — ссылка остаётся, видеопамять не
    // освобождается, бюджет считает путь вытесненным. Проверяется тем, что
    // видит САМ материал в момент вызова, а не порядком строк.
    const { observer, scene } = makeObserver()
    const PATH = 'planets/moon/moon_slope.webp'
    let seenAtUpdate: Texture | undefined

    const mesh = new Mesh()
    mesh.name = 'Moon'
    const material = {
      resetMaterial: vi.fn(),
      updateMaterial: (): void => void (seenAtUpdate = resourceStorage.getTexture(PATH))
    }
    Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
    scene.add(mesh)

    const texture = new Texture()
    texture.name = PATH
    resourceStorage.addTexture(texture)

    observer.evictPath({ actorId: 19, name: 'Moon', path: PATH, typeRank: MAP_TYPE_RANK.slope, actorPriority: 0 })

    expect(seenAtUpdate).toBeUndefined()
    expect(resourceStorage.getTexture(PATH)).toBeUndefined()
    expect(material.resetMaterial).not.toHaveBeenCalled()

    resourceStorage.deleteAllTextures()
  })

  it('сбрасывает материал только выселяемого актора', async () => {
    // Без предварительного collectCandidates у наблюдателя нет записи в
    // pathActors для этого пути — эвикшен падает на кандидата-заявителя
    // (fallback), поэтому Mars, у которого свой узел в сцене, не трогается.
    const { observer, scene } = makeObserver()
    const resets: string[] = []

    for (const name of ['Earth', 'Mars']) {
      const mesh = new Mesh()
      mesh.name = name
      const material = { resetMaterial: (): void => void resets.push(name), updateMaterial: vi.fn() }
      Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
      scene.add(mesh)
    }

    observer.evictPath({ actorId: 1, name: 'Earth', path: 'planets/earth.jpg', typeRank: MAP_TYPE_RANK.diffuse, actorPriority: 0 })

    expect(resets).toEqual(['Earth'])
  })

  it('вытеснение не стирает закешированный вес текстуры из бюджета', () => {
    // Разрешение текстуры — свойство ФАЙЛА, а не резидентности: вытеснение
    // освобождает видеопамять, но не делает файл другого размера. Забывать
    // замер на вытеснении означало бы, что возврат тела снова оценивается
    // вслепую (ASSUMED_TEXTURE_BYTES) — переоценивая типичный 2K-файл
    // вшестнадцатеро и, для тела крупнее бюджета целиком, воссоздавая
    // бесконечный цикл перезагрузки, который убирает пол.
    const { observer, budget } = makeObserver()
    const PATH = 'planets/earth.jpg'

    const texture = new Texture()
    texture.image = { width: 2048, height: 1024 }
    budget.measure(PATH, texture)

    expect(budget.sizeOf(PATH)).toBe(textureBytes(2048, 1024))

    observer.evictPath({ actorId: 1, name: 'Earth', path: PATH, typeRank: MAP_TYPE_RANK.diffuse, actorPriority: 0 })

    expect(budget.sizeOf(PATH)).toBe(textureBytes(2048, 1024))
  })

  it('вытеснение не бросает, когда renderable === null', () => {
    // hasRenderable вернёт true для { renderable: null } — проверяет только
    // "свойство существует", не "оно не null". node.renderable?.material
    // тогда undefined, и .resetMaterial() на undefined бросает. SceneManager
    // (SceneManager.ts:70) уже страхует именно так: hasRenderable(x) &&
    // x.renderable !== null — ResourceObserver обязан делать то же самое.
    const { observer, scene } = makeObserver()

    const mesh = new Mesh()
    mesh.name = 'Earth'
    Object.defineProperty(mesh, 'renderable', { value: null, writable: true })
    scene.add(mesh)

    expect(() =>
      observer.evictPath({ actorId: 1, name: 'Earth', path: 'planets/earth.jpg', typeRank: MAP_TYPE_RANK.diffuse, actorPriority: 0 })
    ).not.toThrow()
  })

  it('вытеснение трогает материалы ВСЕХ текущих владельцев пути (pathActors), а не только заявителя', () => {
    // evictPath доверяет решению целиком (см. докблок метода): раз путь уже
    // выбран на вытеснение (обычно — потому что дедуплицированный спрос ВСЕХ
    // совладельцев вместе не поместился в бюджет), применяет его безусловно
    // ко всем, кто на путь ссылается в `pathActors` — Earth и Mars оба лишаются
    // общего диффуза, а не только заявитель. `pathActors` заполняется вручную
    // (обходя `collectCandidates`) — так же, как это делает реальный пересчёт.
    //
    // «Держится, пока нужен другому телу» здесь НЕ проверяется: рефкаунт по
    // отдельным наблюдателям — ловушка (наблюдаемость ≠ место в бюджете,
    // шаренный путь не вытеснялся бы никогда), его в коде нет. Честный
    // сценарий «путь пережил вытеснение ОДНОГО совладельца, потому что другой
    // всё ещё в бюджете» проверяется через реальный decideStreaming/closestChange
    // в ResourceObserverClosestChange.spec.ts — там дедупликация путей
    // структурно не даёт такому пути попасть в decision.evict вовсе.
    const { observer, scene } = makeObserver()
    const resets: string[] = []
    const SHARED = 'planets/shared.jpg'

    for (const name of ['Earth', 'Mars']) {
      const mesh = new Mesh()
      mesh.name = name
      const material = { resetMaterial: (): void => void resets.push(name), updateMaterial: vi.fn() }
      Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
      scene.add(mesh)
    }

    const texture = new Texture()
    texture.name = SHARED
    resourceStorage.addTexture(texture)

    // `_map` (actorId → имя) заполняется реальным `collectCandidates` в
    // проде — здесь подставляется вручную тем же приёмом, что и `pathActors`,
    // иначе `withActorMaterial` не найдёт Mars по одному только id.
    const internals = observer as unknown as {
      pathActors: Map<string, Set<number>>
      _map: Map<number, { getAttribute: (key: string) => string }>
    }
    internals.pathActors.set(SHARED, new Set([1, 2]))
    internals._map.set(1, { getAttribute: () => 'Earth' })
    internals._map.set(2, { getAttribute: () => 'Mars' })

    observer.evictPath({ actorId: 1, name: 'Earth', path: SHARED, typeRank: MAP_TYPE_RANK.diffuse, actorPriority: 0 })

    expect(resets.slice().sort()).toEqual(['Earth', 'Mars'])
    expect(resourceStorage.getTexture(SHARED)).toBeUndefined()

    resourceStorage.deleteAllTextures()
  })
})

// Финальное ревью water-foundation, находка №2: вода висит ребёнком
// TerrainSphere (WaterSphere), не самим .renderable узла — фан-аут
// вытеснения раньше видел только node.renderable.material (PlanetMaterial) и
// не трогал водный материал вовсе. Вода узнавала о диспоузе своей slope-карты
// лишь на следующем кадре (WaterSphere.onVisibleUpdate), а рендер ТЕКУЩЕГО
// кадра успевал перезалить уже диспоузнутую resourceStorage.deleteTexture
// текстуру в GL без владельца в реестре — утечка GL-объекта.
describe('ResourceObserver: дочерний материал-подписчик (WaterMaterial на WaterSphere), находка №2 финального ревью', () => {
  it('вытеснение slope-пути земли: uSlopeMap воды становится null В ТОМ ЖЕ тике, что и primary', () => {
    const { observer, scene } = makeObserver()
    const PATH = 'planets/earth/earth_slope.webp'
    let waterSeenAtUpdate: unknown = 'не вызывался'

    const mesh = new Mesh()
    mesh.name = 'Earth'
    const primaryMaterial = { resetMaterial: vi.fn(), updateMaterial: vi.fn() }
    const waterMaterial = {
      resetMaterial: vi.fn(),
      updateMaterial: (): void => void (waterSeenAtUpdate = resourceStorage.getTexture(PATH))
    }
    Object.defineProperty(mesh, 'renderable', {
      value: { material: primaryMaterial, children: [{ material: waterMaterial }] },
      writable: true
    })
    scene.add(mesh)

    const texture = new Texture()
    texture.name = PATH
    resourceStorage.addTexture(texture)

    // slope — не диффуз (typeRank), primary получает updateMaterial, не resetMaterial
    observer.evictPath({ actorId: 1, name: 'Earth', path: PATH, typeRank: MAP_TYPE_RANK.slope, actorPriority: 0 })

    expect(waterSeenAtUpdate).toBeUndefined() // updateMaterial воды видел путь уже вне резервуара
    expect(primaryMaterial.updateMaterial).toHaveBeenCalledTimes(1)
    expect(waterMaterial.resetMaterial).not.toHaveBeenCalled()

    resourceStorage.deleteAllTextures()
  })

  it('живые патчи рельефа (Mesh.material === primary) не дублируют вызов — дедуп по ссылке', () => {
    const { observer, scene } = makeObserver()

    const mesh = new Mesh()
    mesh.name = 'Earth'
    const primaryMaterial = { resetMaterial: vi.fn(), updateMaterial: vi.fn() }
    const waterMaterial = { resetMaterial: vi.fn(), updateMaterial: vi.fn() }
    // патч рельефа — ребёнок renderable с ТЕМ ЖЕ материалом, что primary (как
    // TerrainPatchPool реально шарит один материал на все живые меши)
    const patchChild = { material: primaryMaterial }
    const waterChild = { material: waterMaterial }
    Object.defineProperty(mesh, 'renderable', {
      value: { material: primaryMaterial, children: [patchChild, patchChild, waterChild] },
      writable: true
    })
    scene.add(mesh)

    observer.evictPath({ actorId: 1, name: 'Earth', path: 'planets/earth/earth.jpg', typeRank: MAP_TYPE_RANK.diffuse, actorPriority: 0 })

    // primary: ровно один вызов fn() строкой withActorMaterial — дубли патчей
    // с той же ссылкой на материал не вызывают его повторно через фан-аут детей
    expect(primaryMaterial.resetMaterial).toHaveBeenCalledTimes(1)
    // вода — отдельный материал, синхронизируется updateMaterial(), не resetMaterial
    // (диффуз — ресурс PRIMARY, не подписчика, см. докблок syncSubscriberMaterials)
    expect(waterMaterial.updateMaterial).toHaveBeenCalledTimes(1)
    expect(waterMaterial.resetMaterial).not.toHaveBeenCalled()
  })

  it('вытеснение НЕсвязанного диффуза не сбрасывает воду на заглушку — только updateMaterial, не resetMaterial', () => {
    const { observer, scene } = makeObserver()

    const mesh = new Mesh()
    mesh.name = 'Earth'
    const primaryMaterial = { resetMaterial: vi.fn(), updateMaterial: vi.fn() }
    const waterMaterial = { resetMaterial: vi.fn(), updateMaterial: vi.fn() }
    Object.defineProperty(mesh, 'renderable', {
      value: { material: primaryMaterial, children: [{ material: waterMaterial }] },
      writable: true
    })
    scene.add(mesh)

    observer.evictPath({ actorId: 1, name: 'Earth', path: 'planets/earth/earth.jpg', typeRank: MAP_TYPE_RANK.diffuse, actorPriority: 0 })

    expect(primaryMaterial.resetMaterial).toHaveBeenCalledTimes(1) // диффуз земли — primary уходит на заглушку
    expect(waterMaterial.resetMaterial).not.toHaveBeenCalled() // вода не диффузная, resetMaterial ей не про это
    expect(waterMaterial.updateMaterial).toHaveBeenCalledTimes(1) // но пересинхронизацию получает — идемпотентно
  })
})
