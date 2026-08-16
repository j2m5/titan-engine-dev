import { describe, it, expect, vi, afterEach } from 'vitest'
import { Mesh, Scene, Texture, Vector3 } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'
import { MAP_TYPE_RANK } from '@/core/streaming/types'
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
 * Задача 2 переехала с учёта по актору на учёт по пути: `loaded`/`inFlight`/
 * `attempted` теперь `Set<string>`, а `actorPaths` (actorId → пути) заменён
 * на `pathActors` (путь → id акторов-владельцев).
 */
type StreamingInternals = {
  loaded: Set<string>
  inFlight: Set<string>
  attempted: Set<string>
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

  it('бюджет впритык двум диффузам — грузятся оба, bump менее приоритетного тела не помещается', async () => {
    // Единица бюджета — путь (карта), не тело: decideStreaming ранжирует
    // ЖАДНО по (typeRank asc, actorPriority desc), а не по актору целиком.
    // При нехватке места диффуз ВТОРОГО по приоритету тела обгоняет bump
    // ПЕРВОГО — рельеф всех тел важнее косметики одного (см. decideStreaming.ts,
    // «жадный остаток»). Раньше (актор-центричный decideStreaming, до задачи 2)
    // тот же бюджет грузил Меркурий целиком (диффуз+bump) и не трогал Цереру —
    // сейчас это не так, и это осознанная смена гранулярности бюджета.
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    // Оба тела ещё ни разу не грузились — decideStreaming использует
    // завышенную оценку ~8K на путь, а не реальный вес мок-текстуры. Бюджет
    // ровно на два диффуза (Меркурия и Цереры), не на два пути одного тела.
    const { observer, handlers, data } = makeObserver(SIZE_8K * 2, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Mercury', record('Mercury', 300))
    data.set('Ceres', record('Ceres', 100))

    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury.jpg' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/ceres/ceres.jpg' }))
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury_bump.jpg' }))
    expect(load).toHaveBeenCalledTimes(2)
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
      // полёте", которое проверяет тест. Bump — независимый кандидат (задача
      // 2 грузит пути конкурентно, не последовательно по актору) и
      // резолвится сразу, чтобы обе загрузки могли нормально завершиться.
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

    // Диффуз и bump — два независимых пути, оба стартуют в этом же цикле.
    expect(load).toHaveBeenCalledTimes(2)

    // Второй пересчёт с той же дистанцией — оба пути Меркурия уже loaded, а
    // диффуз ещё и inFlight.
    await handlers['ClosestChange'](record('Mercury', 300))

    // Не переспросили (те же два вызова) и не вытеснили.
    expect(load).toHaveBeenCalledTimes(2)
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

    // Korriban I и II (реальные акторы 93 и 94) делят диффуз, bump и четыре
    // detail-текстуры (тот же физический файл на семь планет Korriban I–VII), но
    // height/slope у каждого свои (фикс-раунд 1 Task 4: общая карта, откалиброванная
    // под радиус I, давала VII 577% его бюджета высоты — батч перешёл на пер-тело
    // генерации korriban1..korriban7).
    const sharedPaths = [
      'planets/StarWars/korriban/i/i.jpg',
      'planets/StarWars/korriban/i/i_bump.jpg',
      'terrain/rocky_trail_diff.webp',
      'terrain/rocky_trail_nor.webp',
      'terrain/rocky_trail_arm.webp',
      'terrain/moon_01_nor.webp'
    ]
    const korribanISlope = 'planets/StarWars/korriban/i/korriban1_slope.webp'
    const korribanIISlope = 'planets/StarWars/korriban/i/korriban2_slope.webp'

    data.set('Korriban I', record('Korriban I', 100))
    await handlers['ClosestChange'](record('Korriban I', 100))

    expect(load).toHaveBeenCalledTimes(7) // диффуз + bump + своя slope + 4 detail
    for (const path of [...sharedPaths, korribanISlope]) expect(resourceStorage.getTexture(path), path).toBeDefined()

    // Korriban II входит в зону. Диффуз/bump/detail уже в реестре — повторного
    // сетевого запроса по ним быть не должно, но своя slope-карта — новый путь.
    data.set('Korriban II', record('Korriban II', 120))
    await handlers['ClosestChange'](record('Korriban II', 120))

    expect(load).toHaveBeenCalledTimes(8)
    expect(resourceStorage.getTexture(korribanIISlope)).toBeDefined()

    // Прямое вытеснение путей Korriban I — по одному вызову на путь, ровно
    // так, как их вернул бы decideStreaming.evict от лица актора 93.
    // pathActors уже заполнен настоящими closestChange-циклами выше, поэтому
    // "шаренный путь не удаляется" здесь проверяется на реальных данных, а
    // не на подставном pathActors, как в ResourceObserverStreaming.spec.ts.
    const evictedTypeRank: Record<string, number> = {
      'planets/StarWars/korriban/i/i.jpg': MAP_TYPE_RANK.diffuse,
      'planets/StarWars/korriban/i/i_bump.jpg': MAP_TYPE_RANK.bump,
      'terrain/rocky_trail_diff.webp': MAP_TYPE_RANK.detailDiffuse,
      'terrain/rocky_trail_nor.webp': MAP_TYPE_RANK.detailNormal,
      'terrain/rocky_trail_arm.webp': MAP_TYPE_RANK.detailArm,
      'terrain/moon_01_nor.webp': MAP_TYPE_RANK.detailNormal2,
      [korribanISlope]: MAP_TYPE_RANK.slope
    }

    for (const path of [...sharedPaths, korribanISlope]) {
      observer.evictPath({ actorId: 93, name: 'Korriban I', path, typeRank: evictedTypeRank[path], actorPriority: 0 })
    }

    // Общие пути пережили вытеснение первого владельца — Korriban II всё ещё на
    // них ссылается. Собственная slope-карта Korriban I — больше ничья, снята.
    for (const path of sharedPaths) expect(resourceStorage.getTexture(path), path).toBeDefined()
    expect(resourceStorage.getTexture(korribanISlope)).toBeUndefined()
    expect(resourceStorage.getTexture(korribanIISlope)).toBeDefined()
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
    // вместить оба «наивных» резерва (7+7 путей), иначе Korriban II не попадёт
    // в wanted этого пересчёта вовсе, и тест перестанет проверять дедуп.
    const { observer, handlers, data } = makeObserver(SIZE_8K * 16, load)
    observer.scenario = HORUSET_SYSTEM

    // Оба актора — candidates уже в ПЕРВОМ пересчёте, ни один ещё не
    // загружен: decision.load отдаёт их ОБОИХ разом.
    data.set('Korriban I', record('Korriban I', 100))
    data.set('Korriban II', record('Korriban II', 120))

    await handlers['ClosestChange'](record('Korriban I', 100))

    // Шесть общих путей (диффуз + bump + 4 detail) грузятся по разу, а не по
    // два (на каждого из двух акторов, разделяющих комплект); плюс две
    // собственные slope-карты (korriban1/korriban2 — фикс-раунд 1 Task 4 снял
    // общую карту) — итого восемь сетевых запросов, а не десять.
    expect(load).toHaveBeenCalledTimes(8)

    // И ровно одна запись в реестре на путь, а не две — иначе вторая
    // Texture осталась бы в реестре недиспоузнутой и недостижимой.
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/i.jpg').count()).toBe(1)
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/i_bump.jpg').count()).toBe(1)
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
    // Держится открытым только запрос SHARED_DIFFUSE — путей у Korriban I
    // семь, и задача 2 грузит их конкурентно (не по одному на актора, как
    // было раньше), так что "первый вызов, второй вызов" по номеру больше не
    // адресует именно диффуз. Остальные пути (bump/detail/собственная slope)
    // резолвятся сразу и в проверяемую гонку не входят.
    const SHARED_DIFFUSE = 'planets/StarWars/korriban/i/i.jpg'
    const resolvers: Array<(result: LoadResult) => void> = []
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      if (request.name === SHARED_DIFFUSE) {
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
    expect(pathLoads.has(SHARED_DIFFUSE)).toBe(true)

    const staleReservation = pathLoads.get(SHARED_DIFFUSE)

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

  it('устаревший резолв после смены сценария не трогает живую загрузку того же пути', async () => {
    // Удаления `loaded`/`pathActors` и снятие `inFlight`, ключуемые путём,
    // без сверки эпохи, разбирали бы учёт СВЕЖЕЙ загрузки того же пути,
    // начатой уже после смены сценария. Наблюдалось на реальном сценарии:
    // устаревший резолв снимал пометки живой загрузки того же пути, и
    // последующее вытеснение освобождало разделяемый диффуз, который другое
    // тело ещё показывало.
    //
    // Задача 2 сделала диффуз и bump ОДНОГО тела независимыми кандидатами:
    // `Promise.all(decision.load.map(loadPath))` дозапускает их конкурентно
    // (а не строго друг за другом, как было у actor-центричного `loadActor`),
    // так что в рамках одного пересчёта оба пути стартуют синхронно.
    // Держим открытыми только вызовы диффуза (1-й — цикл 1 "устаревший", 3-й
    // — цикл 2 "живой"); bump-вызовы (2-й, 4-й) резолвятся сразу — тест их
    // не касается, но им нужно завершиться, чтобы Promise.all не завис.
    const resolvers: Array<(result: LoadResult) => void> = []
    let callIndex: number = 0
    const load = vi.fn((): Promise<LoadResult> => {
      callIndex += 1

      if (callIndex === 1 || callIndex === 3) {
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

    // Бюджет ровно на одного актора (два пути по 8K-оценке).
    const { observer, handlers, data } = makeObserver(SIZE_8K * 2, load)
    observer.scenario = SOLAR_SYSTEM
    const evictSpy = vi.spyOn(observer, 'evictPath')

    data.set('Mercury', record('Mercury', 300))

    const first: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    // Диффуз held, bump резолвится сразу — оба пути дозапускаются конкурентно.
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

  it('диффуз тела, чей замеренный вес равен всему бюджету, не вытесняется и не грузится заново — второстепенный путь просто не помещается', async () => {
    // Меркурий — единственный кандидат, значит всегда топ по приоритету: пол
    // decideStreaming обязан удержать его ДИФФУЗ в reserved на КАЖДОМ цикле,
    // даже когда честный замер (не слепая оценка) показывает вес, равный
    // всему бюджету целиком. Бюджет впритык ОДНОМУ 8K-пути — единица бюджета
    // теперь путь, не тело: bump того же Меркурия никогда не помещается
    // (не floor), но это не создаёт бесконечного цикла загрузки/вытеснения,
    // потому что bump никогда и не грузился — вытеснять нечего.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeBigTexture() // замер даст SIZE_8K на путь
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K, load)
    observer.scenario = SOLAR_SYSTEM
    const evictSpy = vi.spyOn(observer, 'evictPath')

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1: диффуз — floor, грузится безусловно и занимает весь бюджет;
    // bump не помещается (не floor) и не грузится вовсе.
    await handlers['ClosestChange'](record('Mercury', 300))
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury.jpg' }))

    // Цикл 2: sizeOf теперь отдаёт честный SIZE_8K (не слепую оценку) — ровно
    // весь бюджет. Меркурий по-прежнему единственный (топ) кандидат — пол
    // обязан удержать диффуз резидентным.
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(evictSpy).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
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
    // resetMaterial, у него отдельный мок, не бросает), и bump (успех →
    // бросок → handleLoadFailure → сам же updateMaterial бросает СНОВА —
    // ловится локальным try/catch внутри handleLoadFailure, не долетает до
    // Promise.all).
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    const { observer, handlers, data, scene } = makeObserver(SIZE_8K * 8, load)
    observer.scenario = SOLAR_SYSTEM
    const MERCURY_DIFFUSE = 'planets/mercury/mercury.jpg'
    const MERCURY_BUMP = 'planets/mercury/mercury_bump.jpg'

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
    expect(state.attempted.has(MERCURY_BUMP)).toBe(true)
    expect(state.loaded.has(MERCURY_BUMP)).toBe(false)
  })
})
