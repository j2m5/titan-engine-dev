import { describe, it, expect, vi, afterEach } from 'vitest'
import { Mesh, Scene, Texture, Vector3 } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Actor } from '@/core/models/Actor'
import { Scenarios } from '@/config/scenarios'
import { config } from '@/core/framework/config'
import type { SceneObserver, ObservableRecord } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { TextureRequest, LoadResult } from '@/core/textures/types'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'

/**
 * Гоняет `closestChange`/`collectCandidates`/бюджетное ранжирование
 * end-to-end. Соседний `ResourceObserverStreaming.spec.ts` проверяет только
 * `evictPath` напрямую и эту связку не покрывает.
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
 * `evictPath`) не отличают «гварда сработала» от «гварда сломана, но
 * дедупликация путей замаскировала последствия».
 *
 * Задача 2 переехала с учёта по актору на учёт по пути: `loaded`/`inFlight`
 * теперь `Set<string>`, `attempted` — `Map<string, number>` (путь → момент
 * провала, нужен для бэкоффа части 3), а `actorPaths` (actorId → пути)
 * заменён на `pathActors` (путь → id акторов-владельцев).
 */
type StreamingInternals = {
  loaded: Set<string>
  inFlight: Set<string>
  attempted: Map<string, number>
  pathActors: Map<string, Set<number>>
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

  it('провал пересчёта не улетает необработанным reject: подписка гасит ошибку и логирует', async () => {
    // EventEmitter.emit дропает промис async-хендлера (callbacks — `=> void`),
    // а тик щёлкает дважды в секунду: любой бросок из closestChange был бы
    // тихим unhandled rejection. Подписка обязана держать .catch, читая
    // this.closestChange в момент вызова — тест подменяет поле на реджект.
    const { observer, handlers } = makeObserver(SIZE_8K, vi.fn())
    observer.scenario = SOLAR_SYSTEM

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(observer as unknown as { closestChange: (e: ObservableRecord) => Promise<void> }).closestChange = () =>
      Promise.reject(new Error('boom'))

    await expect(handlers['ClosestChange'](record('Mercury', 300))).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('dev-сводка решения печатается только при его смене — одинаковые тики не спамят', async () => {
    // Тик SceneObserver зовёт closestChange каждые 500 мс и при неподвижной
    // камере: без гейта console.debug превращается в постоянный dev-спам.
    // Идентичность — сама строка сводки: первая печать (веса путей ещё не
    // замерены, sizeOf=0), вторая после замера (байты изменились), третий
    // одинаковый тик печати уже не даёт.
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Mercury', record('Mercury', 300))

    await handlers['ClosestChange'](record('Mercury', 300))
    const printsAfterFirst = debug.mock.calls.length
    await handlers['ClosestChange'](record('Mercury', 300))
    const printsAfterSecond = debug.mock.calls.length
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(printsAfterFirst).toBe(1)
    // третий тик бит-в-бит повторяет второй — новой печати нет
    expect(debug.mock.calls.length).toBe(printsAfterSecond)
    debug.mockRestore()
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
    // диффуз + slope + 4 detail — терраформный набор Меркурия (легаси-bump
    // удалён из данных: тело переведено на height+slope, см. хендофф задачи 2).
    expect(load).toHaveBeenCalledTimes(6)

    // Цикл 2: Меркурий по-прежнему на первом месте по приоритету (та же
    // дистанция) — значит decision.wanted всё ещё содержит его, и attempted
    // не должен сняться.
    await handlers['ClosestChange'](record('Mercury', 300))

    // Цикл 3: если attempted снялся раньше времени (старое поведение —
    // wanted считался из decision.load, где исключённый никогда не
    // появляется, и снятие блокировки происходило уже на цикле 2), актор
    // ретраится здесь — новые вызовы load. Если фикс на месте, вызовов
    // по-прежнему ровно шесть.
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledTimes(6)
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

  it('бюджет впритык двум диффузам — оба грузятся, но пара floor Меркурия (диффуз+slope) съедает остаток', async () => {
    // Единица бюджета — путь (карта), не тело: decideStreaming ранжирует
    // ЖАДНО по (typeRank asc, actorPriority desc), а не по актору целиком.
    // Пол (floor) — терраформная арка задачи 2 дала Меркурию честный slope,
    // и теперь пол это ПАРА (диффуз+slope) топ-тела, допущенная безусловно
    // даже сверх бюджета (см. decideStreaming.ts). При бюджете ровно на два
    // 8K-пути пол Меркурия сам занимает оба места, но диффуз Цереры всё
    // равно проходит — он ранжирован выше slope и detail-набора Меркурия
    // (typeRank diffuse=0 < slope=1), и бюджет считается по путям, не по
    // акторам целиком.
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    // Оба тела ещё ни разу не грузились — decideStreaming использует
    // завышенную оценку ~8K на путь, а не реальный вес мок-текстуры. Бюджет
    // ровно на два 8K-пути.
    const { observer, handlers, data } = makeObserver(SIZE_8K * 2, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Mercury', record('Mercury', 300))
    data.set('Ceres', record('Ceres', 100))

    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury.jpg' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury_slope.webp' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/ceres/ceres.jpg' }))
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/ceres/ceres_slope.webp' }))
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury_bump.jpg' }))
    expect(load).toHaveBeenCalledTimes(3)
  })

  // Облачный слой ВЕРНУЛСЯ решением владельца (2026-08-19, приёмочная волна
  // 4, №3) — фильтр 'cloud' из streamable-кандидатов (приёмочная волна 2,
  // №2) снят: USE_CLOUD снова ставится при cloudMap, карту снова стоит
  // стримить в VRAM.
  it('облачная карта Земли становится кандидатом streaming — запрашивается сетью при щедром бюджете', async () => {
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    // Бюджет шире обычного (×16, не ×8): облако снова конкурирует за место —
    // ×8 хватало, пока cloud был отфильтрован (волна 2), теперь ему нужен запас.
    const { observer, handlers, data } = makeObserver(SIZE_8K * 16, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Earth', record('Earth', 300))
    await handlers['ClosestChange'](record('Earth', 300))

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/earth/earth_clouds.jpg' }))
    // Остальные потоковые карты Земли — по-прежнему честные кандидаты.
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/earth/earth.jpg' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/earth/earth_night.jpg' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/earth/earth_specular.jpg' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/earth/earth_slope.webp' }))
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

      // Только диффуз Меркурия держится открытым — он и создаёт окно "в
      // полёте", которое проверяет тест. Остальные пять путей (slope+4
      // detail; легаси-bump удалён из данных) — независимые кандидаты (задача
      // 2 грузит пути конкурентно, не последовательно по актору) и
      // резолвятся сразу, чтобы все загрузки могли нормально завершиться.
      if (callIndex === 1) {
        return new Promise<LoadResult>((resolve: (result: LoadResult) => void): void => {
          hold.resolve = resolve
        })
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    const evictSpy = vi.spyOn(observer, 'evictPath')

    data.set('Mercury', record('Mercury', 300))

    const first: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))

    // Все шесть путей Меркурия (диффуз+slope+4detail) — независимые
    // кандидаты, стартуют в этом же цикле.
    expect(load).toHaveBeenCalledTimes(6)

    // Второй пересчёт с той же дистанцией — все пути Меркурия уже loaded, а
    // диффуз ещё и inFlight.
    await handlers['ClosestChange'](record('Mercury', 300))

    // Не переспросили (те же шесть вызовов) и не вытеснили.
    expect(load).toHaveBeenCalledTimes(6)
    expect(evictSpy).not.toHaveBeenCalled()

    hold.resolve?.({ ok: true, texture: makeTexture() })
    await first
  })

  it('два актора, разделяющие путь, грузят его один раз — сеть не задваивается', async () => {
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

    // Korriban I и II (реальные акторы 93 и 94) делят четыре detail-текстуры
    // (тот же физический файл на семь планет Korriban I–VII; легаси-bump
    // удалён из данных вместе с остальными переведёнными на height+slope
    // телами; диффуз-ресурс удалён аркой процедурной поверхности Task 6 —
    // диффуз у этих тел больше не файл, а рантайм-генерация, стримеру не
    // виден), но height/slope у каждого свои (фикс-раунд 1 Task 4: общая
    // карта, откалиброванная под радиус I, давала VII 577% его бюджета
    // высоты — батч перешёл на пер-тело генерации korriban1..korriban7).
    const sharedPaths = ['terrain/rocky_trail_diff.webp', 'terrain/rocky_trail_nor.webp', 'terrain/rocky_trail_arm.webp', 'terrain/moon_01_nor.webp']
    const korribanISlope = 'planets/StarWars/korriban/i/korriban1_slope.webp'
    const korribanIISlope = 'planets/StarWars/korriban/i/korriban2_slope.webp'

    data.set('Korriban I', record('Korriban I', 100))
    await handlers['ClosestChange'](record('Korriban I', 100))

    expect(load).toHaveBeenCalledTimes(5) // своя slope + 4 detail (без диффуза — процедурное тело)
    for (const path of [...sharedPaths, korribanISlope]) expect(resourceStorage.getTexture(path), path).toBeDefined()

    // Korriban II входит в зону. Detail уже в реестре — повторного
    // сетевого запроса по нему быть не должно, но своя slope-карта — новый путь.
    data.set('Korriban II', record('Korriban II', 120))
    await handlers['ClosestChange'](record('Korriban II', 120))

    expect(load).toHaveBeenCalledTimes(6)
    expect(resourceStorage.getTexture(korribanIISlope)).toBeDefined()
  })

  it('шаренный путь честно вытесняется по бюджету, когда дедуплицированный спрос ВСЕХ совладельцев не помещается (репро ревью: Korriban I+II в бюджете на 6, вход III выталкивает detailNormal2)', async () => {
    // Прежняя версия этого сценария вызывала evictPath НАПРЯМУЮ с рукодельным
    // pathActors и проверяла, что «шаренный путь не удаляется, пока нужен
    // другому телу» — это маскировало реальный баг (HIGH ревью после f6fe748):
    // гвард `pathStillReferenced` смотрел на pathActors (кто НАБЛЮДАЕТСЯ), а не
    // на решение decideStreaming (кто ПОМЕСТИЛСЯ В БЮДЖЕТ), и путь, честно
    // проигравший бюджету, не вытеснялся никогда. Теперь сценарий идёт через
    // РЕАЛЬНЫЙ closestChange/decision.evict — ту же дорогу, что и продакшен.
    //
    // Числа воспроизводят репро ревью буквально, но легаси-bump (использовавшийся
    // как жертва до данных-правки задачи 2) удалён из данных Korriban, а
    // диффуз-ресурс снят целиком аркой процедурной поверхности (Task 6 —
    // диффуз тел рендерится рантайм-генератором, стримеру не виден) — у
    // Korriban I+II теперь 6 разных путей (4detail общие, у каждого своя
    // slope), бюджет — ровно на 6. Жертва-замена — detailNormal2
    // (terrain/moon_01_nor.webp, MAP_TYPE_RANK 2.3): он тоже общий на все
    // Korriban-тела и, как и bump раньше, самый младший ранг среди путей этого
    // раунда (ниже него по рангу в остальной системе нет ни одной общей
    // карты у этих трёх акторов — только slope/detail, см.
    // storage/database/actorResource.ts). Вход Korriban III добавляет
    // седьмой путь (свою slope, ранг 1) — бюджет не резиновый, и младший
    // ранг уступает место старшему.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      // Единый вес что до, что после замера (8192×4096 — тот же размер, что
      // ASSUMED_TEXTURE_BYTES) — бюджет считается в целых картах, без
      // блуждания оценки между слепым и честным замером.
      const texture = makeBigTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data, scene } = makeObserver(SIZE_8K * 6, load)
    observer.scenario = HORUSET_SYSTEM
    vi.useFakeTimers()

    const VICTIM = 'terrain/moon_01_nor.webp'
    // Процедурное тело без диффуз-ресурса: floor decideStreaming у топ-тела —
    // одна лишь его slope (floorDiffuse не находится, floorPaths = {slope}).
    const FLOOR_SLOPE = 'planets/StarWars/korriban/i/korriban1_slope.webp'
    const owners: Record<string, ReturnType<typeof vi.fn>> = {}

    // Korriban I (radius 1740) — топ-приоритет при равных дистанциях, его
    // slope — floor decideStreaming, держится безусловно.
    for (const name of ['Korriban I', 'Korriban II', 'Korriban III']) {
      const mesh = new Mesh()
      mesh.name = name
      const updateMaterial = vi.fn()
      owners[name] = updateMaterial
      Object.defineProperty(mesh, 'renderable', { value: { material: { resetMaterial: vi.fn(), updateMaterial } }, writable: true })
      scene.add(mesh)
    }

    data.set('Korriban I', record('Korriban I', 100))
    data.set('Korriban II', record('Korriban II', 100))

    await handlers['ClosestChange'](record('Korriban I', 100))

    const state = streamingState(observer)

    expect(state.loaded.size).toBe(6)
    expect(state.loaded.has(VICTIM)).toBe(true)

    // Резидентность младше MIN_RESIDENCY_MS пинит путь через isPinned
    // независимо от бюджета — двигаем время, чтобы проверить именно
    // бюджетное решение, а не защиту свежей загрузки.
    vi.advanceTimersByTime(11_000)

    data.set('Korriban III', record('Korriban III', 100))
    await handlers['ClosestChange'](record('Korriban III', 100))

    // Бюджет по-прежнему на 6 путей, а не на 7 — раньше (баг) loaded.size
    // рос до 7, перерасходуя бюджет и никогда не возвращаясь к лимиту.
    expect(state.loaded.size).toBe(6)
    expect(state.loaded.has(VICTIM)).toBe(false)
    expect(resourceStorage.getTexture(VICTIM)).toBeUndefined()

    // Floor топ-тела (его slope) как был резидентным, так и остался.
    expect(state.loaded.has(FLOOR_SLOPE)).toBe(true)
    expect(resourceStorage.getTexture(FLOOR_SLOPE)).toBeDefined()

    // Материалы ВСЕХ трёх совладельцев detailNormal2 обновились (не сброшены
    // на заглушку — это не диффуз, тело переживает потерю detail-карты).
    expect(owners['Korriban I']).toHaveBeenCalled()
    expect(owners['Korriban II']).toHaveBeenCalled()
    expect(owners['Korriban III']).toHaveBeenCalled()

    vi.useRealTimers()
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

    // decideStreaming резервирует бюджет по СВОЕМУ списку путей каждого
    // кандидата, не зная о меж-акторном совпадении строк — бюджет должен
    // вместить оба «наивных» резерва (5+5 путей — процедурное тело без
    // диффуз-ресурса, Task 6), иначе Korriban II не попадёт в wanted этого
    // пересчёта вовсе, и тест перестанет проверять дедуп.
    const { observer, handlers, data } = makeObserver(SIZE_8K * 16, load)
    observer.scenario = HORUSET_SYSTEM

    // Оба актора — candidates уже в ПЕРВОМ пересчёте, ни один ещё не
    // загружен: decision.load отдаёт их ОБОИХ разом.
    data.set('Korriban I', record('Korriban I', 100))
    data.set('Korriban II', record('Korriban II', 120))

    await handlers['ClosestChange'](record('Korriban I', 100))

    // Четыре общих detail-пути (легаси-bump и диффуз-ресурс удалены из
    // данных — тело процедурное, Task 6) грузятся по разу, а не по два (на
    // каждого из двух акторов, разделяющих детальный комплект); плюс две
    // собственные slope-карты (korriban1/korriban2 — фикс-раунд 1 Task 4
    // снял общую карту) — итого шесть сетевых запросов, а не десять
    // (было бы 4×2 + 2 при полном провале дедупа общих путей).
    expect(load).toHaveBeenCalledTimes(6)

    // И ровно одна запись в реестре на путь, а не две — иначе вторая
    // Texture осталась бы в реестре недиспоузнутой и недостижимой. Одной из
    // shared detail-карт (detailDiffuse) достаточно, чтобы поймать
    // регрессию дедупликации — не нужно перечислять все четыре detail-пути.
    expect(resourceStorage.textures.where('name', 'terrain/rocky_trail_diff.webp').count()).toBe(1)
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/korriban1_slope.webp').count()).toBe(1)
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/korriban2_slope.webp').count()).toBe(1)
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
    //
    // Держится открытым только запрос SHARED_DETAIL (одна из четырёх общих
    // detail-текстур Korriban — диффуз-ресурса у процедурного тела больше
    // нет, Task 6) — путей у Korriban I пять, и задача 2 грузит их
    // конкурентно (не по одному на актора, как было раньше), так что
    // "первый вызов, второй вызов" по номеру больше не адресует именно
    // держащийся путь. Остальные пути (detail/собственная slope) резолвятся
    // сразу и в проверяемую гонку не входят.
    const SHARED_DETAIL = 'terrain/rocky_trail_diff.webp'
    const resolvers: Array<(result: LoadResult) => void> = []
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      if (request.name === SHARED_DETAIL) {
        return new Promise<LoadResult>((resolve) => resolvers.push(resolve))
      }

      const texture = makeTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = HORUSET_SYSTEM
    const pathLoads = streamingState(observer).pathLoads

    // Korriban I заявляет общий путь первым — становится владельцем брони.
    // Это и есть будущий "устаревший владелец".
    data.set('Korriban I', record('Korriban I', 100))
    const stale: Promise<void> = handlers['ClosestChange'](record('Korriban I', 100))

    expect(resolvers).toHaveLength(1)
    expect(pathLoads.has(SHARED_DETAIL)).toBe(true)

    const staleReservation = pathLoads.get(SHARED_DETAIL)

    // Сценарий "сменился" — сеттер безусловно бампает epoch и полностью
    // сбрасывает pathLoads/loaded/pathActors независимо от того, каким
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
    expect(pathLoads.has(SHARED_DETAIL)).toBe(true)

    const liveReservation = pathLoads.get(SHARED_DETAIL)

    expect(liveReservation).not.toBe(staleReservation)

    // Резолвим УСТАРЕВШИЙ (первый) вызов. Его собственный continuation
    // владеет своей записью (owner=true) — но по факту в pathLoads под этим
    // же ключом уже лежит ЧУЖАЯ (живая) бронь. Сверка на равенство промиса
    // обязана предотвратить удаление.
    resolvers[0]({ ok: true, texture: makeTexture() })
    await stale

    expect(pathLoads.get(SHARED_DETAIL)).toBe(liveReservation)

    // Достраиваем живую загрузку, чтобы не оставить висящий промис.
    resolvers[1]({ ok: true, texture: makeTexture() })
    await live
  })

  it('устаревший резолв после смены сценария не трогает живую загрузку того же пути', async () => {
    // Удаления `loaded`/`pathActors` и снятие `inFlight`, ключуемые путём,
    // без сверки эпохи, разбирали бы учёт СВЕЖЕЙ загрузки того же пути,
    // начатой уже после смены сценария. Наблюдалось на реальном сценарии:
    // устаревший резолв снимал пометки живой загрузки того же пути, и
    // последующее вытеснение освобождало разделяемый диффуз, который другое
    // тело ещё показывало.
    //
    // Задача 2 сделала все пути ОДНОГО тела независимыми кандидатами:
    // `Promise.all(decision.load.map(loadPath))` дозапускает их конкурентно
    // (а не строго друг за другом, как было у actor-центричного `loadActor`),
    // так что в рамках одного пересчёта все шесть путей Меркурия (терраформная
    // арка: диффуз+slope+4detail; легаси-bump удалён из данных) стартуют
    // синхронно. Держим открытыми только вызовы диффуза (1-й — цикл 1
    // "устаревший", 7-й, первый в цикле 2, — "живой"); остальные пять путей
    // каждого цикла резолвятся сразу — тест их не касается, но им нужно
    // завершиться, чтобы Promise.all не завис.
    const resolvers: Array<(result: LoadResult) => void> = []
    let callIndex: number = 0
    const load = vi.fn((): Promise<LoadResult> => {
      callIndex += 1

      if (callIndex === 1 || callIndex === 7) {
        return new Promise<LoadResult>((resolve) => resolvers.push(resolve))
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    const state = streamingState(observer)
    const MERCURY_ACTOR_ID = 5
    const MERCURY_DIFFUSE = 'planets/mercury/mercury.jpg'

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1 (эпоха E1): диффуз Меркурия держится открытым — это и есть
    // "устаревший" вызов.
    const stale: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    expect(resolvers).toHaveLength(1)
    expect(state.loaded.has(MERCURY_DIFFUSE)).toBe(true)
    expect(state.inFlight.has(MERCURY_DIFFUSE)).toBe(true)

    // Сценарий "сменился" — тот же сценарий переприсваивается заново, а не
    // `null`: сеттер безусловно бампает epoch и сбрасывает весь учёт
    // стриминга независимо от значения (см. комментарий выше, тест "устаревший
    // владелец брони"), а кандидаты резолвятся через `this._map`,
    // которую `null` очистил бы без восстановления — цикл 2 не нашёл бы
    // Меркурия кандидатом вообще.
    observer.scenario = SOLAR_SYSTEM

    // Цикл 2 (эпоха E2): Меркурий снова кандидат (тот же actorId) — живая,
    // свежая загрузка. Её диффуз тоже держится открытым.
    const live: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    expect(resolvers).toHaveLength(2)
    expect(state.loaded.has(MERCURY_DIFFUSE)).toBe(true)
    expect(state.inFlight.has(MERCURY_DIFFUSE)).toBe(true)

    // Резолвим УСТАРЕВШИЙ (первый) вызов — именно та гонка.
    resolvers[0]({ ok: true, texture: makeTexture() })
    await stale

    // Прямая проверка: бухгалтерия ЖИВОЙ загрузки (цикл 2) должна пережить
    // резолв устаревшего вызова в точности — не побочные эффекты, а сами
    // записи, которые устаревшая чистка не имеет права трогать.
    expect(state.loaded.has(MERCURY_DIFFUSE)).toBe(true)
    expect(state.inFlight.has(MERCURY_DIFFUSE)).toBe(true)
    expect(state.pathActors.get(MERCURY_DIFFUSE)).toEqual(new Set([MERCURY_ACTOR_ID]))

    // Достраиваем живую загрузку, чтобы не оставить висящий промис.
    resolvers[1]({ ok: true, texture: makeTexture() })
    await live

    // После завершения живой загрузки inFlight снят, путь остаётся loaded.
    expect(state.loaded.has(MERCURY_DIFFUSE)).toBe(true)
    expect(state.inFlight.has(MERCURY_DIFFUSE)).toBe(false)
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

    // Бюджет ровно на пару floor Меркурия (диффуз+slope, два пути по 8K-оценке).
    const { observer, handlers, data } = makeObserver(SIZE_8K * 2, load)
    observer.scenario = SOLAR_SYSTEM
    const evictSpy = vi.spyOn(observer, 'evictPath')

    data.set('Mercury', record('Mercury', 300))

    const first: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    // Диффуз held, slope резолвится сразу — оба floor-пути дозапускаются конкурентно.
    expect(load).toHaveBeenCalledTimes(2)

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

  it('диффуз и slope тела, чей замеренный вес занимает весь бюджет, не вытесняются и не грузятся заново — остальные пути просто не помещаются', async () => {
    // Меркурий — единственный кандидат, значит всегда топ по приоритету: пол
    // decideStreaming обязан удержать его ДИФФУЗ И SLOPE в reserved на
    // КАЖДОМ цикле (терраформная арка задачи 2 дала телу честный slope — пол
    // теперь пара, не одна карта), даже когда честный замер (не слепая
    // оценка) показывает суммарный вес пары вдвое дороже всего бюджета.
    // Бюджет впритык ОДНОМУ 8K-пути — bump и detail-набор того же Меркурия
    // никогда не помещаются (не floor), но это не создаёт бесконечного цикла
    // загрузки/вытеснения, потому что они никогда и не грузились — вытеснять
    // нечего.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeBigTexture() // замер даст SIZE_8K на путь
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K, load)
    observer.scenario = SOLAR_SYSTEM
    const evictSpy = vi.spyOn(observer, 'evictPath')

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1: диффуз и slope — пара floor, грузятся безусловно и занимают
    // весь бюджет (и сверх него); bump и detail не помещаются (не floor) и
    // не грузятся вовсе.
    await handlers['ClosestChange'](record('Mercury', 300))
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury.jpg' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury_slope.webp' }))

    // Цикл 2: sizeOf теперь отдаёт честный SIZE_8K на путь (не слепую
    // оценку) — пара уже вдвое дороже всего бюджета. Меркурий по-прежнему
    // единственный (топ) кандидат — пол обязан удержать оба пути
    // резидентными.
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(evictSpy).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('имя, разделяемое с кольцом/атмосферой, резолвится в планету, а не в актора без стримируемых путей', async () => {
    // Saturn — три реальных актора с ОДНИМ именем: планета (id 11, диффуз;
    // легаси-bump планеты удалён из данных задачей 2 как старый эксперимент —
    // Сатурн стримит только диффуз), кольцо (id 39, единственный ресурс —
    // resident PNG колец, не streamable) и атмосфера (id 50, вообще без
    // ресурсов). Раньше `collectCandidates` резолвил имя через
    // `Actor.where({ name }).first()` по ВСЕЙ таблице акторов без учёта
    // сценария/дерева — совпадало с планетой только потому, что у неё меньший
    // id, чем у кольца и атмосферы. Резолв через `this._map` (обход дерева
    // сценария, родитель раньше детей) корректен структурно, а не по
    // счастливой нумерации: ring/atmosphere — всегда дети своей планеты, не
    // её соседи с тем же именем.
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

    // Реальный путь ПЛАНЕТЫ — не resident-текстура кольца (её вообще не
    // просят: `lifecycle !== 'streamable'`) и не пустой список атмосферы.
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/saturn/saturn.jpg' }))
    expect(load).toHaveBeenCalledTimes(1)

    // collectCandidates больше не бьёт по ORM за каждое наблюдаемое тело —
    // резолв идёт через уже построенный this._map, а не через Actor.where.
    expect(whereSpy).not.toHaveBeenCalled()

    whereSpy.mockRestore()
  })

  it('успешная загрузка не бросает, когда renderable === null', async () => {
    // Тот же провал, что и в evictPath (см. ResourceObserverStreaming.spec.ts),
    // но на пути успеха loadPath: hasRenderable({ renderable: null }) вернёт
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

  it('бросок из updateMaterial не улетает необработанным — путь откатывается в attempted', async () => {
    // tryLoad гасит ошибки ПРОВАЙДЕРА, но loadPath вокруг него — нет: бросок
    // из ORM, из сборки запроса или (как здесь) из updateMaterial() после
    // успешной загрузки раньше улетал из Promise.all необработанным отказом,
    // а путь оставался в loaded без текстуры — decideStreaming никогда больше
    // его не запросит, поскольку не грузит уже loaded.
    //
    // Материал ломается на КАЖДОМ updateMaterial — значит throw'ы ловит и
    // диффуз (успех → бросок в конце loadPath → handleLoadFailure →
    // resetMaterial, у него отдельный мок, не бросает), и slope (легаси-bump
    // Меркурия удалён из данных задачей 2; slope — такая же второстепенная,
    // не-диффузная карта тела, её путь через loadPath идентичен: успех →
    // бросок → handleLoadFailure → сам же updateMaterial бросает СНОВА —
    // ловится локальным try/catch внутри handleLoadFailure, не долетает до
    // Promise.all).
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    const { observer, handlers, data, scene } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    const MERCURY_DIFFUSE = 'planets/mercury/mercury.jpg'
    const MERCURY_SLOPE = 'planets/mercury/mercury_slope.webp'

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

    // Откат идентичен обычному провалу: оба пути уходят в attempted и
    // покидают loaded — а не остаются в loaded без единого шанса на повтор.
    expect(state.attempted.has(MERCURY_DIFFUSE)).toBe(true)
    expect(state.loaded.has(MERCURY_DIFFUSE)).toBe(false)
    expect(state.attempted.has(MERCURY_SLOPE)).toBe(true)
    expect(state.loaded.has(MERCURY_SLOPE)).toBe(false)
  })

  it('субпиксельное тело не становится кандидатом (карты не запрашиваются); крупное — кандидат как обычно', async () => {
    // Угловая отсечка (config/streaming.minBodyPixels, порог см.
    // src/core/streaming/angularCutoff.ts): тело с actorPriority ниже порога
    // не разворачивается в MapCandidate вовсе — closestChange не запросит по
    // нему ни одной сети. Меркурий (радиус 2440 км) на дистанции 2000
    // субпикселен (диаметр < 4 px при номинальных fov 50°/1080p), на
    // дистанции 300 — обычный кандидат (те же тесты выше используют именно
    // эту дистанцию).
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Mercury', record('Mercury', 2000))
    await handlers['ClosestChange'](record('Mercury', 2000))

    expect(load).not.toHaveBeenCalled()

    data.set('Mercury', record('Mercury', 300))
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury.jpg' }))
  })

  it('регрессия владельца в миниатюре: далёкая субпиксельная "планета" не отжимает бюджет у detail ближней', async () => {
    // Репро приёмки: без отсечки диффуз ЛЮБОГО наблюдаемого тела (даже
    // субпиксельного) — это кандидат ранга 0, а decideStreaming ранжирует
    // СНАЧАЛА по рангу, только потом по приоритету (см. decideStreaming.ts,
    // «жадный остаток») — диффуз далёкого Урана в очереди раньше detail
    // Луны по построению, независимо от того, насколько Уран крохотный на
    // экране. Бюджет ровно на 6 путей Луны (диффуз+slope+4 detail, вес карт
    // одинаков — makeBigTexture даёт то же значение, что и слепая оценка):
    // без отсечки Уран отжимает один слот и Луна недополучает последнюю
    // detail-карту; с отсечкой Уран вовсе не кандидат — Луна получает всё.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeBigTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 6, load)
    observer.scenario = SOLAR_SYSTEM

    const MOON_DETAIL_NORMAL2 = 'terrain/moon_01_nor.webp'
    const URANUS_DIFFUSE = 'planets/uranus/uranus.png'

    data.set('Moon', record('Moon', 10)) // близко — топ-приоритет, floor
    data.set('Uranus', record('Uranus', 10000)) // далеко — субпиксельно

    await handlers['ClosestChange'](record('Moon', 10))

    const state = streamingState(observer)

    expect(state.loaded.has(MOON_DETAIL_NORMAL2)).toBe(true)
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: URANUS_DIFFUSE }))
  })

  it('после истечения бэкоффа провалившийся путь снова предлагается к загрузке', async () => {
    // Пол (диффуз + slope ближайшего тела) попадает в wantedPaths безусловно,
    // поэтому правило «вышел из желаемого — прощён» его не освобождает: без
    // бэкоффа одна сетевая икота на теле, к которому летит пользователь,
    // означала бы серый плейсхолдер до конца сессии.
    vi.useFakeTimers()

    let failing: boolean = true
    const load = vi.fn(
      (): Promise<LoadResult> =>
        failing
          ? Promise.resolve({ ok: false as const, texture: null, error: new Error('сеть недоступна') })
          : Promise.resolve({ ok: true as const, texture: makeTexture() })
    )

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1: всё проваливается, пути уходят в attempted.
    await handlers['ClosestChange'](record('Mercury', 300))
    const afterFirst: number = load.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    // Цикл 2 сразу же: бэкофф не истёк — ни одной новой попытки.
    await handlers['ClosestChange'](record('Mercury', 300))
    expect(load.mock.calls.length).toBe(afterFirst)

    // Цикл 3 после бэкоффа: сеть починилась, пути снова предлагаются.
    failing = false
    vi.setSystemTime(Date.now() + config('streaming.retryBackoffMs') + 1)
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load.mock.calls.length).toBeGreaterThan(afterFirst)

    vi.useRealTimers()
  })

  it('тело, упавшее под угловой порог, теряет резидентные карты — вытеснение орфанного пути', async () => {
    // Путь без ЕДИНОГО текущего владельца невидим для decideStreaming (тот
    // видит только текущих candidates) и никогда не попал бы в decision.evict
    // сам по себе — closestChange обязан вытеснить такой путь напрямую
    // (evictOrphanedPaths), иначе резидентная карта тела, упавшего под
    // порог, зависла бы в loaded навсегда.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeBigTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    vi.useFakeTimers()

    const URANUS_DIFFUSE = 'planets/uranus/uranus.png'

    data.set('Uranus', record('Uranus', 300)) // близко — обычный кандидат, грузится
    await handlers['ClosestChange'](record('Uranus', 300))

    const state = streamingState(observer)

    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(true)
    expect(resourceStorage.getTexture(URANUS_DIFFUSE)).toBeDefined()

    // Уран отодвинулся — субпиксельно, больше не кандидат вовсе. Орфанная
    // очистка ТОЖЕ защищена MIN_RESIDENCY_MS (фикс-раунд ре-ревью, Low) — тот
    // же гистерезис, что у бюджетного вытеснения — поэтому время двигается
    // явно, иначе свежая загрузка была бы просто пропущена гвардом.
    vi.advanceTimersByTime(11_000)
    data.set('Uranus', record('Uranus', 10000))
    await handlers['ClosestChange'](record('Uranus', 10000))

    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(false)
    expect(resourceStorage.getTexture(URANUS_DIFFUSE)).toBeUndefined()

    vi.useRealTimers()
  })

  it('орфан-очистка не трогает путь, ушедший под порог, пока он ещё в полёте — гонка, не утечка', async () => {
    // Фикс-раунд ре-ревью (Medium-High): без гварда `inFlight` орфан-чистка
    // делала бы loaded.delete + deleteTexture в ПУСТОТУ (реестр ещё ничего не
    // зарегистрировал — путь в полёте), а loadPath после await всё равно
    // регистрирует текстуру и ставит loadedAt, НЕ ЗНАЯ, что путь уже
    // выселили отсюда. Текстура осталась бы резидентной вне `loaded` и вне
    // бюджета навсегда: следующий орфан-проход ходит по `this.loaded`, а
    // пути там уже нет, чтобы заметить пропажу.
    const hold: { resolve: ((result: LoadResult) => void) | null } = { resolve: null }

    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      if (request.name === 'planets/uranus/uranus.png') {
        return new Promise<LoadResult>((resolve) => {
          hold.resolve = resolve
        })
      }

      const texture = makeBigTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM

    const URANUS_DIFFUSE = 'planets/uranus/uranus.png'
    const state = streamingState(observer)

    // Цикл 1: Уран близко — диффуз стартует загрузку, держится открытым
    // (эмулирует загрузку "в полёте" на момент падения приоритета).
    data.set('Uranus', record('Uranus', 300))
    const inFlight: Promise<void> = handlers['ClosestChange'](record('Uranus', 300))

    expect(state.inFlight.has(URANUS_DIFFUSE)).toBe(true)
    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(true)

    // Цикл 2: Уран отодвинулся раньше, чем загрузка успела резолвиться —
    // орфан-чистка обязана ПРОПУСТИТЬ путь целиком (он всё ещё inFlight).
    data.set('Uranus', record('Uranus', 10000))
    await handlers['ClosestChange'](record('Uranus', 10000))

    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(true)
    expect(state.inFlight.has(URANUS_DIFFUSE)).toBe(true)

    // Резолвим загрузку — loadPath регистрирует текстуру штатно. Реестр ищет
    // по texture.name (в проде его проставляет applyTextureParameters).
    const resolvedTexture = makeBigTexture()
    resolvedTexture.name = URANUS_DIFFUSE
    hold.resolve?.({ ok: true, texture: resolvedTexture })
    await inFlight

    expect(resourceStorage.getTexture(URANUS_DIFFUSE)).toBeDefined()
    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(true)
    expect(state.inFlight.has(URANUS_DIFFUSE)).toBe(false)

    // Цикл 3: Уран по-прежнему далеко (не кандидат) — теперь путь настоящий
    // орфан (loaded, не inFlight). Прошло 0 мс с loadedAt — свежий орфан,
    // MIN_RESIDENCY_MS его защищает: ещё НЕ вытеснен.
    await handlers['ClosestChange'](record('Uranus', 10000))

    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(true)
    expect(resourceStorage.getTexture(URANUS_DIFFUSE)).toBeDefined()
  })

  it('свежезагруженный орфан не вытесняется (гистерезис отсечки); устаревший — вытесняется', async () => {
    // Фикс-раунд ре-ревью (Low): без MIN_RESIDENCY_MS тело, чей приоритет
    // дрожит у порога 4 px, грузилось бы и вытеснялось по кругу каждый такт
    // — тот же класс дребезга, что у бюджетного вытеснения (isPinned).
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeBigTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    vi.useFakeTimers()

    const URANUS_DIFFUSE = 'planets/uranus/uranus.png'
    const state = streamingState(observer)

    data.set('Uranus', record('Uranus', 300))
    await handlers['ClosestChange'](record('Uranus', 300))
    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(true)

    // Уран падает под порог СРАЗУ после загрузки — путь свежий (loadedAt
    // только что выставлен), орфан-чистка обязана его пропустить.
    data.set('Uranus', record('Uranus', 10000))
    await handlers['ClosestChange'](record('Uranus', 10000))

    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(true)
    expect(resourceStorage.getTexture(URANUS_DIFFUSE)).toBeDefined()

    // Время прошло дольше MIN_RESIDENCY_MS, Уран по-прежнему субпикселен —
    // теперь орфан устарел, вытесняется.
    vi.advanceTimersByTime(11_000)
    await handlers['ClosestChange'](record('Uranus', 10000))

    expect(state.loaded.has(URANUS_DIFFUSE)).toBe(false)
    expect(resourceStorage.getTexture(URANUS_DIFFUSE)).toBeUndefined()

    vi.useRealTimers()
  })
})
