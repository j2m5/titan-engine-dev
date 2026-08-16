import { describe, it, expect, vi, afterEach } from 'vitest'
import { Mesh, Scene, Texture, Vector3 } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Actor } from '@/core/models/Actor'
import { Scenarios } from '@/config/scenarios'
import type { SceneObserver, ObservableRecord } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { TextureRequest, LoadResult } from '@/core/textures/types'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'

/**
 * Гоняет `closestChange`/`collectCandidates`/бюджетное ранжирование
 * end-to-end. Соседний `ResourceObserverStreaming.spec.ts` проверяет только
 * `evictActor` напрямую и эту связку не покрывает.
 *
 * Тела — настоящие акторы движка (Mercury/Ceres/Korriban I/Korriban II), а не
 * фикстуры: `collectCandidates` ходит в реальный `Actor`/`Resource` через ORM,
 * подменить эти вызовы нечем без искажения самого проверяемого механизма.
 * `distance`/`position` в `SceneObserver.data` подконтрольны тесту напрямую.
 *
 * `collectCandidates` резолвит имя через `this._map`
 * (наполняется `setMap`), а не запросом `Actor.where({ name })` — значит
 * КАЖДЫЙ тест обязан выставить `observer.scenario` ДО первого `ClosestChange`,
 * иначе `_map` пуст и ни один кандидат не резолвится. Mercury/Ceres/Moon —
 * дети root'а Солнечной системы (id 1), Korriban I/II — дети root'а системы
 * Хорусет (id 86, отдельный сценарий) — потому им нужны РАЗНЫЕ конфиги.
 */

const SOLAR_SYSTEM = Scenarios.find((s) => s.rootId === 1)!
const HORUSET_SYSTEM = Scenarios.find((s) => s.rootId === 86)!

const SIZE_8K: number = textureBytes(8192, 4096)

function record(name: string, distance: number): ObservableRecord {
  return { name, distance, position: new Vector3() }
}

function makeTexture(): Texture {
  const texture: Texture = new Texture()
  texture.image = { width: 2048, height: 1024 }
  return texture
}

/** Текстура, чей ЗАМЕРЕННЫЙ вес — как у 8K, а не как у стандартной мок-2K. */
function makeBigTexture(): Texture {
  const texture: Texture = new Texture()
  texture.image = { width: 8192, height: 4096 }
  return texture
}

/**
 * Приватная бухгалтерия наблюдателя, доступная снаружи только приведением
 * типа — тот же приём, что и в `ResourceObserverScenario.spec.ts`. Нужен,
 * когда поведенческие побочные эффекты (счётчик сетевых вызовов, вызов
 * `evictActor`) не отличают «гварда сработала» от «гварда сломана, но
 * дедупликация путей замаскировала последствия».
 */
type StreamingInternals = {
  loaded: Set<number>
  inFlight: Set<number>
  attempted: Set<number>
  actorPaths: Map<number, string[]>
  pathLoads: Map<string, Promise<LoadResult | null>>
}

function streamingState(observer: ResourceObserver): StreamingInternals {
  return observer as unknown as StreamingInternals
}

function makeObserver(
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

describe('ResourceObserver: closestChange end-to-end', () => {
  afterEach(() => {
    resourceStorage.deleteAllTextures()
  })

  it('провалившийся актор не ретраится немедленно, пока остаётся приоритетным', async () => {
    // Все пути Меркурия проваливаются — актор целиком уходит в attempted.
    const load = vi.fn(
      (): Promise<LoadResult> => Promise.resolve({ ok: false as const, texture: null, error: new Error('сеть недоступна') })
    )

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1: провал, актор уходит в attempted.
    await handlers['ClosestChange'](record('Mercury', 300))
    expect(load).toHaveBeenCalledTimes(2) // диффуз + bump

    // Цикл 2: Меркурий по-прежнему на первом месте по приоритету (та же
    // дистанция) — значит decision.wanted всё ещё содержит его, и attempted
    // не должен сняться.
    await handlers['ClosestChange'](record('Mercury', 300))

    // Цикл 3: если attempted снялся раньше времени (старое поведение —
    // wanted считался из decision.load, где исключённый никогда не
    // появляется, и снятие блокировки происходило уже на цикле 2), актор
    // ретраится здесь — новые вызовы load. Если фикс на месте, вызовов
    // по-прежнему ровно два.
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('крупное дальнее тело обходит мелкое ближнее и грузится первым', async () => {
    const order: string[] = []
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      order.push(request.name)
      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    // Меркурий (радиус 2440 км) втрое дальше Цереры (469.7 км), но угловой
    // размер всё равно больше: 2440/300 ≈ 8.13 против 469.7/100 ≈ 4.70.
    data.set('Mercury', record('Mercury', 300))
    data.set('Ceres', record('Ceres', 100))

    await handlers['ClosestChange'](record('Mercury', 300))

    // decision.load сохраняет убывающий порядок приоритета (см.
    // decideStreaming.spec.ts) — Меркурий первым запускает свою загрузку.
    expect(order[0]).toBe('planets/mercury/mercury.jpg')
    expect(order).toContain('planets/ceres/ceres.jpg')
  })

  it('бюджет впритык одному телу — грузится только приоритетное', async () => {
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    // Оба тела ещё ни разу не грузились — decideStreaming использует
    // завышенную оценку ~8K на путь, а не реальный вес мок-текстуры. Бюджет
    // ровно на два пути (диффуз+bump) одного актора.
    const { observer, handlers, data } = makeObserver(SIZE_8K * 2, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Mercury', record('Mercury', 300))
    data.set('Ceres', record('Ceres', 100))

    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury.jpg' }))
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/ceres/ceres.jpg' }))
  })

  it('второй пересчёт, пока актор ещё грузится, не переспрашивает и не вытесняет его', async () => {
    // Мутируемый объект-обёртка вместо голого `let`: иначе TS сужает тип
    // резолвера по видимому потоку управления, теряя его после промежуточных
    // await и объявляя вызов недостижимым (`never`) — резолвер-то на самом
    // деле присваивается асинхронно, из колбэка исполнителя промиса.
    const hold: { resolve: ((result: LoadResult) => void) | null } = { resolve: null }
    let callIndex: number = 0

    const load = vi.fn((): Promise<LoadResult> => {
      callIndex += 1

      // Только первый вызов (диффуз Меркурия) держится открытым — он и создаёт
      // окно "в полёте", которое проверяет тест. Остальные (bump) резолвятся
      // сразу, чтобы загрузка после resolve могла нормально завершиться.
      if (callIndex === 1) {
        return new Promise<LoadResult>((resolve: (result: LoadResult) => void): void => {
          hold.resolve = resolve
        })
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    const evictSpy = vi.spyOn(observer, 'evictActor')

    data.set('Mercury', record('Mercury', 300))

    const first: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledTimes(1)

    // Второй пересчёт с той же дистанцией — Меркурий уже loaded И inFlight.
    await handlers['ClosestChange'](record('Mercury', 300))

    // Не переспросили (тот же единственный вызов) и не вытеснили.
    expect(load).toHaveBeenCalledTimes(1)
    expect(evictSpy).not.toHaveBeenCalled()

    hold.resolve?.({ ok: true, texture: makeTexture() })
    await first
  })

  it('два актора, разделяющие путь, грузят его один раз — путь переживает вытеснение одного из них', async () => {
    // Реестр ищет текстуру по `texture.name`; в проде его проставляет
    // `applyTextureParameters` (см. src/core/textures/applyTextureParameters.ts),
    // мок делает это вручную — иначе resourceStorage.getTexture(path) не
    // нашёл бы то, что якобы уже загружено.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = HORUSET_SYSTEM

    // Korriban I и II (реальные акторы 93 и 94) делят все семь streamable-путей —
    // диффуз, bump, slope и четыре detail-текстуры (терраформная арка synth-heightmap) —
    // один и тот же комплект файлов на семь планет Korriban I–VII.
    const sharedPaths = [
      'planets/StarWars/korriban/i/i.jpg',
      'planets/StarWars/korriban/i/i_bump.jpg',
      'planets/StarWars/korriban/i/korriban_slope.webp',
      'terrain/rocky_trail_diff.webp',
      'terrain/rocky_trail_nor.webp',
      'terrain/rocky_trail_arm.webp',
      'terrain/moon_01_nor.webp'
    ]

    data.set('Korriban I', record('Korriban I', 100))
    await handlers['ClosestChange'](record('Korriban I', 100))

    expect(load).toHaveBeenCalledTimes(7) // диффуз + bump + slope + 4 detail
    for (const path of sharedPaths) expect(resourceStorage.getTexture(path), path).toBeDefined()

    // Korriban II входит в зону, Korriban I остаётся резидентным. Все пути
    // уже в реестре — повторного сетевого запроса быть не должно.
    data.set('Korriban II', record('Korriban II', 120))
    await handlers['ClosestChange'](record('Korriban II', 120))

    expect(load).toHaveBeenCalledTimes(7)

    // Прямое вытеснение Korriban I — ровно то, что сделал бы decideStreaming,
    // выбери он его на вытеснение. Пути принадлежат резиденции по данным.
    observer.evictActor({
      actorId: 93,
      name: 'Korriban I',
      priority: 0,
      paths: sharedPaths
    })

    // Пути пережили вытеснение первого владельца — Korriban II всё ещё на них
    // ссылается.
    for (const path of sharedPaths) expect(resourceStorage.getTexture(path), path).toBeDefined()
  })

  it('два актора, разделяющие путь, В ОДНОМ цикле грузят его один раз — не задваивают ни сеть, ни реестр', async () => {
    // Если оба candidate попадают в decision.load
    // ОДНОГО пересчёта, Promise.all запускает их loadActor конкурентно, и
    // оба успевают проверить реестр ДО того, как первый там что-то
    // зарегистрирует — реестр сам по себе от этой гонки не спасает.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = HORUSET_SYSTEM

    // Оба актора — candidates уже в ПЕРВОМ пересчёте, ни один ещё не
    // загружен: decision.load отдаёт их ОБОИХ разом.
    data.set('Korriban I', record('Korriban I', 100))
    data.set('Korriban II', record('Korriban II', 120))

    await handlers['ClosestChange'](record('Korriban I', 100))

    // Семь общих путей (диффуз + bump + slope + 4 detail) — ровно семь
    // сетевых запросов, а не четырнадцать (по семь на каждого из двух
    // акторов, разделяющих весь комплект).
    expect(load).toHaveBeenCalledTimes(7)

    // И ровно одна запись в реестре на путь, а не две — иначе вторая
    // Texture осталась бы в реестре недиспоузнутой и недостижимой.
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/i.jpg').count()).toBe(1)
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/i_bump.jpg').count()).toBe(1)
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/korriban_slope.webp').count()).toBe(1)
  })

  it('устаревший владелец брони не снимает чужую (живую) бронь по тому же пути после смены сценария', async () => {
    // Удаление записи pathLoads по завершении сверяется не
    // только по ключу пути, но и по РАВЕНСТВУ ПРОМИСА
    // (`this.pathLoads.get(path) === pending`) — это единственное, что
    // мешает устаревшему владельцу снести чужую, более свежую бронь по тому
    // же пути. Без этой сверки (`if (owner)` без сверки промиса) второй
    // актор, претендующий на тот же путь уже в новой эпохе, потерял бы свою
    // бронь при резолве устаревшего владельца — и третий заявитель по тому
    // же пути запустил бы дублирующую сетевую загрузку через границу смены
    // сценария, воссоздавая утечку.
    const resolvers: Array<(result: LoadResult) => void> = []
    let callIndex: number = 0
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      callIndex += 1

      if (callIndex <= 2) {
        return new Promise<LoadResult>((resolve) => resolvers.push(resolve))
      }

      const texture = makeTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = HORUSET_SYSTEM
    const pathLoads = streamingState(observer).pathLoads
    const SHARED_DIFFUSE = 'planets/StarWars/korriban/i/i.jpg'

    // Korriban I заявляет общий путь первым — становится владельцем брони.
    // Это и есть будущий "устаревший владелец".
    data.set('Korriban I', record('Korriban I', 100))
    const stale: Promise<void> = handlers['ClosestChange'](record('Korriban I', 100))

    expect(resolvers).toHaveLength(1)
    expect(pathLoads.has(SHARED_DIFFUSE)).toBe(true)

    const staleReservation = pathLoads.get(SHARED_DIFFUSE)

    // Сценарий "сменился" — сеттер безусловно бампает epoch и полностью
    // сбрасывает pathLoads/loaded/actorPaths независимо от того, каким
    // значением его перезаписали (см. докблок сеттера `scenario`). Тот же
    // сценарий переприсваивается заново (а не `null`), потому что код
    // резолвит кандидатов через `this._map`, а `null` очистил бы её без
    // восстановления — Korriban II не нашёлся бы кандидатом вообще, и гонка,
    // которую проверяет этот тест, до него бы не дошла. Korriban I по-прежнему
    // больше не кандидат (покинул зону/данные наблюдателя) — это делает
    // `data.delete`, а не сброс сценария.
    observer.scenario = HORUSET_SYSTEM
    data.delete('Korriban I')

    // Korriban II заявляет ТОТ ЖЕ путь уже в новой эпохе — свежая, живая
    // бронь (pathLoads был очищен, так что это НОВЫЙ владелец, не сосед по
    // старому промису).
    data.set('Korriban II', record('Korriban II', 120))
    const live: Promise<void> = handlers['ClosestChange'](record('Korriban II', 120))

    expect(resolvers).toHaveLength(2)
    expect(pathLoads.has(SHARED_DIFFUSE)).toBe(true)

    const liveReservation = pathLoads.get(SHARED_DIFFUSE)

    expect(liveReservation).not.toBe(staleReservation)

    // Резолвим УСТАРЕВШИЙ (первый) вызов. Его собственный continuation
    // владеет своей записью (owner=true) — но по факту в pathLoads под этим
    // же ключом уже лежит ЧУЖАЯ (живая) бронь. Сверка на равенство промиса
    // обязана предотвратить удаление.
    resolvers[0]({ ok: true, texture: makeTexture() })
    await stale

    expect(pathLoads.get(SHARED_DIFFUSE)).toBe(liveReservation)

    // Достраиваем живую загрузку, чтобы не оставить висящий промис.
    resolvers[1]({ ok: true, texture: makeTexture() })
    await live
  })

  it('устаревший резолв после смены сценария не трогает живую загрузку того же актора', async () => {
    // Удаления loaded/actorPaths и снятие inFlight,
    // ключуемые только по actorId, без сверки эпохи, разбирали учёт СВЕЖЕЙ
    // загрузки того же актора, начатой уже после смены сценария. Наблюдалось
    // на реальном сценарии: устаревший резолв Korriban II
    // снимал пометки живой загрузки того же актора, и последующее
    // вытеснение освобождало разделяемый диффуз, который Korriban I ещё
    // показывал.
    //
    // Побочных эффектов тут недостаточно (счётчик
    // сетевых вызовов, вызов evictActor через третий пересчёт) — при снятых
    // гвардах третий пересчёт ошибочно считал актора незагруженным, но
    // повторный loadActor молча присоединялся (через pathLoads) к чужому
    // незавершённому промису вместо нового сетевого запроса. Оба прежних
    // assert'а проходили "случайно", хотя re-run произошёл, а третий
    // пересчёт вдобавок зависал в реальном прогоне (join на промис, который
    // тест ещё не отпустил). Теперь бухгалтерия живой загрузки проверяется
    // НАПРЯМУЮ, без третьего пересчёта вовсе.
    //
    // Держим открытыми только первые два вызова (диффуз "устаревшего" и
    // диффуз "живого" актора) — остальные (bump с обеих сторон) резолвятся
    // сразу, чтобы обе загрузки могли нормально завершиться после того, как
    // держащиеся пути будут отпущены явно.
    const resolvers: Array<(result: LoadResult) => void> = []
    let callIndex: number = 0
    const load = vi.fn((): Promise<LoadResult> => {
      callIndex += 1

      if (callIndex <= 2) {
        return new Promise<LoadResult>((resolve) => resolvers.push(resolve))
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    const state = streamingState(observer)
    const MERCURY_ACTOR_ID = 5

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1 (эпоха E1): Меркурий начинает грузиться, первый путь (диффуз)
    // держится открытым — это и есть "устаревший" вызов.
    const stale: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    expect(resolvers).toHaveLength(1)

    // Сценарий "сменился" — тот же сценарий переприсваивается заново, а не
    // `null`: сеттер безусловно бампает epoch и сбрасывает весь учёт
    // стриминга независимо от значения (см. комментарий выше, тест "устаревший
    // владелец брони"), а кандидаты резолвятся через `this._map`,
    // которую `null` очистил бы без восстановления — цикл 2 не нашёл бы
    // Меркурия кандидатом вообще.
    observer.scenario = SOLAR_SYSTEM

    // Цикл 2 (эпоха E2): Меркурий снова кандидат (тот же actorId) — живая,
    // свежая загрузка. Её первый путь тоже держится открытым.
    const live: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    expect(resolvers).toHaveLength(2)
    expect(state.loaded.has(MERCURY_ACTOR_ID)).toBe(true)
    expect(state.inFlight.has(MERCURY_ACTOR_ID)).toBe(true)

    // Резолвим УСТАРЕВШИЙ (первый) вызов — именно та гонка.
    resolvers[0]({ ok: true, texture: makeTexture() })
    await stale

    // Прямая проверка: бухгалтерия ЖИВОЙ загрузки (цикл 2) должна пережить
    // резолв устаревшего вызова в точности — не побочные эффекты, а сами
    // записи, которые устаревшая чистка не имеет права трогать.
    expect(state.loaded.has(MERCURY_ACTOR_ID)).toBe(true)
    expect(state.inFlight.has(MERCURY_ACTOR_ID)).toBe(true)
    expect(state.actorPaths.get(MERCURY_ACTOR_ID)).toEqual([
      'planets/mercury/mercury.jpg',
      'planets/mercury/mercury_bump.jpg'
    ])

    // Достраиваем живую загрузку, чтобы не оставить висящий промис.
    resolvers[1]({ ok: true, texture: makeTexture() })
    await live

    // После завершения живой загрузки inFlight снят, актор остаётся loaded.
    expect(state.loaded.has(MERCURY_ACTOR_ID)).toBe(true)
    expect(state.inFlight.has(MERCURY_ACTOR_ID)).toBe(false)
  })

  it('inFlight защищает актор от вытеснения, пока он грузится впервые, даже если приоритет упал', async () => {
    // inFlight — НЕ избыточный
    // термин. Пока актор грузится ВПЕРВЫЕ, loadedAt для него ещё не
    // выставлен (выставляется только по успеху) — второе условие isPinned
    // тогда всегда ложно, и защищать актора может только inFlight. Проверка:
    // Меркурий начинает грузиться (inFlight, budget впритык ему одному),
    // затем появляется гораздо более приоритетное тело — Меркурий выпадает
    // из reserved, но всё ещё должен быть защищён, пока не завершил свою
    // ПЕРВУЮ загрузку.
    const hold: { resolve: ((result: LoadResult) => void) | null } = { resolve: null }
    let callIndex: number = 0

    const load = vi.fn((): Promise<LoadResult> => {
      callIndex += 1

      if (callIndex === 1) {
        return new Promise<LoadResult>((resolve) => {
          hold.resolve = resolve
        })
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    // Бюджет ровно на одного актора (два пути по 8K-оценке).
    const { observer, handlers, data } = makeObserver(SIZE_8K * 2, load)
    observer.scenario = SOLAR_SYSTEM
    const evictSpy = vi.spyOn(observer, 'evictActor')

    data.set('Mercury', record('Mercury', 300))

    const first: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    expect(load).toHaveBeenCalledTimes(1) // held — Меркурий inFlight, ещё ни разу не succeeded

    // Луна (радиус 1735.97 км) совсем рядом — приоритет ~173.6, намного выше
    // меркуриевых ~8.13. Бюджет впритык теперь достаётся ей, Меркурий
    // выпадает из reserved. Но он ещё грузится ВПЕРВЫЕ — loadedAt не
    // выставлен, только inFlight его защищает.
    data.set('Moon', record('Moon', 10))
    await handlers['ClosestChange'](record('Moon', 10))

    expect(evictSpy).not.toHaveBeenCalled()

    hold.resolve?.({ ok: true, texture: makeTexture() })
    await first
  })

  it('тело, чей замеренный вес превышает весь бюджет, не вытесняется и не грузится заново', async () => {
    // Меркурий — единственный кандидат, значит всегда топ по приоритету: пол
    // decideStreaming обязан удержать его в reserved на КАЖДОМ цикле, даже
    // когда честный замер (не слепая оценка) показывает вес больше всего
    // бюджета. Без пола актор сначала грузится вслепую (первый цикл), замер
    // на цикле 2 вскрывает перерасход, и БЕЗ пола актор ушёл бы в evict —
    // ровно тот бесконечный цикл перезагрузки, который убирает пол.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeBigTexture() // замер даст SIZE_8K на каждый путь
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    // Бюджет впритык ОДНОМУ 8K-пути — у Меркурия их два (диффуз+bump), то
    // есть реальный вес после замера (2×SIZE_8K) вдвое больше всего бюджета.
    const { observer, handlers, data } = makeObserver(SIZE_8K, load)
    observer.scenario = SOLAR_SYSTEM
    const evictSpy = vi.spyOn(observer, 'evictActor')

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1: оценка ещё слепая (ASSUMED_TEXTURE_BYTES = SIZE_8K на путь) —
    // пол по-любому применился бы, но здесь актор проходит и без него, потому
    // что слепая оценка для одного пути ровно на бюджет. Оба пути грузятся,
    // budget.measure фиксирует их РЕАЛЬНЫЙ вес — SIZE_8K каждый.
    await handlers['ClosestChange'](record('Mercury', 300))
    expect(load).toHaveBeenCalledTimes(2)

    // Цикл 2: sizeOf теперь отдаёт честные SIZE_8K на путь, суммарно 2×SIZE_8K
    // — больше всего бюджета. Меркурий по-прежнему единственный (топ)
    // кандидат — пол обязан удержать его резидентным.
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(evictSpy).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('имя, разделяемое с кольцом/атмосферой, резолвится в планету, а не в актора без стримируемых путей', async () => {
    // Saturn — три реальных актора с ОДНИМ именем: планета (id 11, диффуз+
    // bump), кольцо (id 39, единственный ресурс — resident PNG колец, не
    // streamable) и атмосфера (id 50, вообще без ресурсов). Раньше
    // `collectCandidates` резолвил имя через `Actor.where({ name }).first()`
    // по ВСЕЙ таблице акторов без учёта сценария/дерева — совпадало с
    // планетой только потому, что у неё меньший id, чем у кольца и атмосферы.
    // Резолв через `this._map` (обход дерева сценария, родитель раньше детей)
    // корректен структурно, а не по счастливой нумерации: ring/atmosphere —
    // всегда дети своей планеты, не её соседи с тем же именем.
    const whereSpy = vi.spyOn(Actor, 'where')

    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Saturn', record('Saturn', 300))
    await handlers['ClosestChange'](record('Saturn', 300))

    // Реальные пути ПЛАНЕТЫ — не resident-текстура кольца (её вообще не
    // просят: `lifecycle !== 'streamable'`) и не пустой список атмосферы.
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/saturn/saturn.jpg' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/saturn/saturn_bump.jpg' }))
    expect(load).toHaveBeenCalledTimes(2)

    // collectCandidates больше не бьёт по ORM за каждое наблюдаемое тело —
    // резолв идёт через уже построенный this._map, а не через Actor.where.
    expect(whereSpy).not.toHaveBeenCalled()

    whereSpy.mockRestore()
  })

  it('успешная загрузка не бросает, когда renderable === null', async () => {
    // Тот же провал, что и в evictActor (см. ResourceObserverStreaming.spec.ts),
    // но на пути успеха loadActor: hasRenderable({ renderable: null }) вернёт
    // true, node.renderable?.material — undefined, и .updateMaterial() на
    // undefined бросает необработанным исключением из closestChange.
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    const { observer, handlers, data, scene } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    const mesh = new Mesh()
    mesh.name = 'Mercury'
    Object.defineProperty(mesh, 'renderable', { value: null, writable: true })
    scene.add(mesh)

    data.set('Mercury', record('Mercury', 300))

    await expect(handlers['ClosestChange'](record('Mercury', 300))).resolves.toBeUndefined()
  })

  it('бросок из updateMaterial не улетает необработанным — актор откатывается в attempted', async () => {
    // tryLoad гасит ошибки ПРОВАЙДЕРА, но loadActor вокруг него — нет: бросок
    // из ORM, из сборки запроса или (как здесь) из updateMaterial() после
    // успешной загрузки раньше улетал из Promise.all необработанным отказом,
    // а актор оставался в loaded без текстур — decideStreaming никогда больше
    // его не запросит, поскольку не грузит уже loaded.
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    const { observer, handlers, data, scene } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    const MERCURY_ACTOR_ID = 5

    const mesh = new Mesh()
    mesh.name = 'Mercury'
    const material = {
      resetMaterial: vi.fn(),
      updateMaterial: (): void => {
        throw new Error('шейдер материала не скомпилировался')
      }
    }
    Object.defineProperty(mesh, 'renderable', { value: { material }, writable: true })
    scene.add(mesh)

    data.set('Mercury', record('Mercury', 300))

    await expect(handlers['ClosestChange'](record('Mercury', 300))).resolves.toBeUndefined()

    const state = streamingState(observer)

    // Откат идентичен обычному провалу: актор уходит в attempted и покидает
    // loaded — а не остаётся в loaded без единого шанса на повторный запрос.
    expect(state.attempted.has(MERCURY_ACTOR_ID)).toBe(true)
    expect(state.loaded.has(MERCURY_ACTOR_ID)).toBe(false)
  })
})
