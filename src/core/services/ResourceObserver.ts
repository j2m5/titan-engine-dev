import { ScenarioConfig } from '@/config/scenarios'
import { IResource } from '@/core/models/types'
import { Resource } from '@/core/models/Resource'
import { Actor } from '@/core/models/Actor'
import { SceneObserver } from '@/core/services/SceneObserver'
import { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadResult, TextureRequest } from '@/core/textures/types'
import { cubeTextureRequest, textureRequestFrom } from '@/core/textures/textureRequest'
import { CubeTexture, DefaultLoadingManager, Scene } from 'three'
import { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import { NotificationSink } from '@/core/ports/NotificationSink'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { hasRenderable } from '@/core/services/SceneManager'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import { decideStreaming } from '@/core/streaming/decideStreaming'
import type { MapCandidate, StreamDecision } from '@/core/streaming/types'
import { MAP_TYPE_RANK, mapTypeRank } from '@/core/streaming/types'
import { minBodyPixelsToPriorityThreshold } from '@/core/streaming/angularCutoff'
import { streaming } from '@/config/streaming'

/**
 * Сколько миллисекунд путь защищён от вытеснения после загрузки.
 *
 * При рабочем наборе в единицы слотов путь у границы бюджета иначе будет
 * грузиться и вытесняться по кругу. Одна ручка вместо двух порогов, и она не
 * зависит от того, как именно дрожит дистанция.
 */
const MIN_RESIDENCY_MS: number = 10_000

/** Защита от деления на ноль, когда камера внутри тела. */
const MIN_DISTANCE: number = 1e-9

/**
 * Порог `actorPriority`, ниже которого тело субпиксельно (см.
 * `minBodyPixelsToPriorityThreshold`, `config/streaming.minBodyPixels`) — его
 * карты не разворачиваются в кандидатов `collectCandidates` вовсе.
 */
const MIN_ACTOR_PRIORITY: number = minBodyPixelsToPriorityThreshold(streaming.streaming.minBodyPixels)

/**
 * Наблюдатель за ресурсами, отвечающий жизненный цикл ресурсов
 */
class ResourceObserver {
  /**
   * Массив ресурсов кубических карт для фона сцены
   */
  public cube: IResource[] = []
  /**
   * Одиночные резидентные текстуры сценария: вспомогательные карты, кольца,
   * заглушки. Загружаются при старте и не вытесняются никогда — их отбирает
   * флаг `lifecycle` в данных, а не список в коде.
   *
   * Кубические карты сюда не входят: им нужен запрос формы из шести граней,
   * он собирается отдельно в `setCubeTextures`.
   */
  public resident: IResource[] = []

  /**
   * Текущий сценарий
   */
  private _scenario: ScenarioConfig | null

  /**
   * Загруженная кубическая карта фона текущего сценария
   */
  private _sceneBackground: CubeTexture | null

  /**
   * Карта содержащая все сущности текущего сценария, где ключ - идентификатор актора
   */
  private readonly _map: Map<number, Actor>

  /**
   * Единица учёта стриминга — путь (карта), не актор: несколько тел могут
   * делить один физический файл, и его резидентность одна на всех.
   *
   * Пути, чьи текстуры в видеопамяти либо в процессе загрузки.
   */
  private readonly loaded: Set<string> = new Set()
  /** Путь → момент загрузки, для минимальной резидентности. */
  private readonly loadedAt: Map<string, number> = new Map()
  /** Пути с загрузкой в полёте: их нельзя ни запрашивать повторно, ни вытеснять. */
  private readonly inFlight: Set<string> = new Set()
  /** Пути, чья загрузка провалилась; сбрасывается, когда путь выходит из `wantedPaths`. */
  private readonly attempted: Set<string> = new Set()
  /**
   * Путь → id акторов, которые на него ссылаются в ТЕКУЩЕМ пересчёте.
   * Перестраивается каждым `collectCandidates` с нуля — отвечает на вопрос
   * «кому сейчас показывать» (материалы), а не «кто когда-то владел». Именно
   * поэтому вытеснение одного тела не трогает путь, которым делится другое:
   * оно всё ещё в этой карте.
   */
  private readonly pathActors: Map<string, Set<number>> = new Map()
  /**
   * Счётчик сбросов сценария. `loadPath` захватывает значение до первого
   * `await`: если к моменту догрузки оно изменилось, сценарий сменился посреди
   * загрузки и результат отбрасывается, а не пишется в разобранный реестр.
   *
   * При расхождении эпох устаревший вызов НЕ трогает состояние по одному
   * пути: под тем же ключом может уже лежать живая запись новой эпохи.
   */
  private epoch: number = 0
  /**
   * Путь → промис ещё не завершившейся загрузки. Два актора, разделяющие путь
   * и загружаемые одновременно, иначе задваивают запрос: проверка реестра не
   * спасает — в этот момент путь не зарегистрирован никем, первый заявитель
   * его тоже ещё грузит, и второй Texture остаётся недостижимым навсегда.
   */
  private readonly pathLoads: Map<string, Promise<LoadResult | null>> = new Map()

  /**
   * @param sceneObserver Наблюдатель за сценой
   * @param textures Единая точка загрузки текстур
   * @param scene Сцена, из которой извлекаются объекты для сброса материалов
   * @param budget Бюджет видеопамяти под стримируемые текстуры
   */
  public constructor(
    private sceneObserver: SceneObserver,
    private textures: TextureProvider,
    private loadingProgress: LoadingProgressReporter,
    private notifications: NotificationSink,
    private scene: Scene,
    private budget: TextureBudget
  ) {
    this._scenario = null
    this._sceneBackground = null
    this._map = new Map()
    this.sceneObserver.subscribe('ClosestChange', this.closestChange)
    this.setResidentTextures()
  }

  /**
   * Геттер для текущего сценария
   */
  public get scenario(): ScenarioConfig | null {
    return this._scenario
  }

  /**
   * Геттер для кубической карты фона сцены
   */
  public get sceneBackground(): CubeTexture | null {
    return this._sceneBackground
  }

  /**
   * Сеттер для текущего сценария
   * @param scenario Новый сценарий
   *
   * Сброс делается здесь, а не в помощнике: `setMap` при `scenario === null`
   * выходит сразу, и выход в меню не очистил бы ничего.
   *
   * Разборка сценария освобождает все текстуры разом, поэтому состояние
   * стриминга обязано обнуляться — иначе записи выглядят загруженными, повтор
   * не случается, и материалы остаются на заглушке. `epoch` увеличивается,
   * чтобы незавершённая загрузка прошлого сценария опознала смену по выходу из
   * `await`. `pathLoads` очищается, иначе свежая загрузка присоединится к
   * промису устаревшей и зарегистрирует диспоузнутую текстуру. `_map` — потому
   * что `setMap` дописывает в него без очистки.
   */
  public set scenario(scenario: ScenarioConfig | null) {
    this._scenario = scenario
    this._sceneBackground = null
    this.epoch += 1
    this.loaded.clear()
    this.loadedAt.clear()
    this.inFlight.clear()
    this.attempted.clear()
    this.pathLoads.clear()
    this.pathActors.clear()
    this._map.clear()
    this.setMap()
    this.setCubeTextures()
  }

  /**
   * Геттер для карты сценария
   */
  public get map(): Map<number, Actor> {
    return this._map
  }

  /**
   * Загружает основные текстуры, необходимые для работы сценария.
   *
   * Регистрацию в реестре делает наблюдатель, а не загрузчик: провайдер только
   * отдаёт текстуру, размещение — здесь.
   */
  public async loadPrimaryTextures(): Promise<void> {
    this.setLoadingProgress()

    const background = this.cube.length ? await this.tryLoad(cubeTextureRequest(this.cube)) : null

    if (background?.ok) {
      this._sceneBackground = background.texture as CubeTexture
      resourceStorage.addTexture(background.texture)
    } else {
      this._sceneBackground = null
    }

    await this.loadInto(this.resident)
  }

  /**
   * Загружает пачку ресурсов и размещает удавшиеся в реестре. Провалившиеся
   * молча пропускаются: провайдер уже вернул заглушку, а сообщение
   * пользователю шлёт DefaultLoadingManager.onError.
   */
  private async loadInto(resources: IResource[]): Promise<void> {
    await Promise.all(
      resources.map(async (resource: IResource): Promise<void> => {
        const result = await this.tryLoad(textureRequestFrom(resource))

        if (!result || !result.ok || !result.texture) return

        resourceStorage.addTexture(result.texture)
      })
    )
  }

  /**
   * Оборачивает `TextureProvider.load`, превращая брошенную ошибку конфигурации
   * в уведомление и пропуск ресурса вместо необработанного отказа промиса.
   *
   * Провайдер бросает нарочно, когда ни одна стратегия не подходит форме
   * запроса (опечатка в расширении, кубмапа не из шести граней). Выше по цепочке
   * обработчика нет ни в одном звене, так что без перехвата здесь приложение
   * зависает на экране загрузки без сообщения.
   */
  private async tryLoad(request: TextureRequest): Promise<LoadResult | null> {
    try {
      return await this.textures.load(request)
    } catch (cause) {
      const error: Error = cause instanceof Error ? cause : new Error(String(cause))

      this.notifications.dispatch({
        type: 'error',
        message: `The error occurred while loading: ${request.name} (${error.message})`
      })

      return null
    }
  }

  /**
   * Устанавливает текстуры кубических карт для текущего сценария
   */
  private setCubeTextures(): void {
    if (this.scenario) {
      this.cube = Resource.query()
        .where({ resourceType: 'cube' })
        .get()
        .whereIn('id', this.scenario.skybox)
        .toJSON() as IResource[]
    }
  }

  /** Отбирает резидентные ресурсы по флагу в данных, а не по списку в коде */
  private setResidentTextures(): void {
    this.resident = Resource.all()
      .filter(
        (resource: Resource): boolean =>
          resource.getAttribute('lifecycle') === 'resident' &&
          resource.getAttribute('resourceType') !== 'cube' &&
          // Карты высот — CPU-данные, их грузит HeightFieldStorage: текстурный
          // путь бросил бы на неизвестном расширении .raw
          resource.getAttribute('resourceType') !== 'height'
      )
      .map((resource: Resource): IResource => resource.toJSON() as IResource)
      .toArray()
  }

  /**
   * Устанавливает карту для текущего сценария
   */
  private setMap(): void {
    if (!this.scenario) return

    const root: Actor | null = Actor.find(this.scenario.rootId)

    if (!root) return

    this.map.set(root.getAttribute('id')!, root)

    root.children.eachRecursive((actor: Actor): void => {
      this.map.set(actor.getAttribute('id')!, actor)
    })
  }

  /**
   * Устанавливает прогресс загрузки текстур
   */
  private setLoadingProgress(): void {
    DefaultLoadingManager.onStart = (url: string, loaded: number, total: number): void => {
      this.loadingProgress.setAsset(url)
      this.loadingProgress.setProgress(loaded)
      this.loadingProgress.setTotal(total)
    }

    DefaultLoadingManager.onProgress = (url: string, loaded: number, total: number): void => {
      this.loadingProgress.setAsset(url)
      this.loadingProgress.setProgress(loaded)
      this.loadingProgress.setTotal(total)
    }

    DefaultLoadingManager.onLoad = (): void => {
      this.loadingProgress.setAsset('')
    }

    DefaultLoadingManager.onError = (url: string): void => {
      this.notifications.dispatch({ type: 'error', message: `The error occurred while loading: ${url}` })
    }
  }

  /**
   * Пересчитывает состав видеопамяти. Вызывается на каждом ClosestChange —
   * то есть при изменении камеры, когда дистанции уже пересчитаны.
   */
  private closestChange = async (): Promise<void> => {
    const { candidates, cutoffCount } = this.collectCandidates()
    const decision: StreamDecision = decideStreaming(
      candidates,
      this.loaded,
      // Условия защищают разные моменты жизни пути и не дублируют друг друга:
      // `inFlight` пинит путь, который грузится впервые (до первого успеха
      // `loadedAt` не выставлен), а порог по `loadedAt` — уже загруженный.
      // Без `inFlight` путь, потерявший приоритет прямо во время первой
      // загрузки, попал бы в вытеснение, а загрузка дописала бы результат в
      // снесённое состояние
      (path: string): boolean =>
        this.inFlight.has(path) || Date.now() - (this.loadedAt.get(path) ?? 0) < MIN_RESIDENCY_MS,
      this.attempted,
      (path: string): number | undefined => this.budget.sizeOf(path),
      this.budget.limit()
    )

    // Провал снимается по `wantedPaths`, а не по `load`: исключённый путь в
    // `load` не появится никогда, и битый путь ретраился бы бесконечно
    for (const path of this.attempted) {
      if (!decision.wantedPaths.has(path)) this.attempted.delete(path)
    }

    if (import.meta.env.DEV) this.logDecision(candidates, decision, cutoffCount)

    for (const candidate of decision.evict) this.evictPath(candidate)
    await Promise.all(decision.load.map((candidate: MapCandidate): Promise<void> => this.loadPath(candidate)))
  }

  /**
   * Компактная dev-сводка решения по слоям — раз на пересчёт, за
   * `import.meta.env.DEV`, Vite вырезает вызов из прод-сборки. Дедуп по пути
   * повторяет тот, что `decideStreaming` делает внутри себя — иначе один
   * шаренный путь посчитался бы дважды на каждого владельца. `cutoffCount` —
   * сколько тел `collectCandidates` не развернул в кандидатов вовсе из-за
   * угловой отсечки (см. `MIN_ACTOR_PRIORITY`) — они в `candidates` не видны,
   * поэтому считаются отдельно и добавляются последней строкой.
   */
  private logDecision(candidates: MapCandidate[], decision: StreamDecision, cutoffCount: number): void {
    const byRank: Map<number, { paths: number; bytes: number; skipped: number }> = new Map()
    const seen: Set<string> = new Set()

    for (const candidate of candidates) {
      if (seen.has(candidate.path)) continue
      seen.add(candidate.path)

      const bucket = byRank.get(candidate.typeRank) ?? { paths: 0, bytes: 0, skipped: 0 }

      if (decision.wantedPaths.has(candidate.path)) {
        bucket.paths += 1
        bucket.bytes += this.budget.sizeOf(candidate.path) ?? 0
      } else {
        bucket.skipped += 1
      }

      byRank.set(candidate.typeRank, bucket)
    }

    const summary: string = [...byRank.entries()]
      .sort(([a]: [number, unknown], [b]: [number, unknown]): number => a - b)
      .map(
        ([rank, stats]: [number, { paths: number; bytes: number; skipped: number }]): string =>
          `rank ${rank}: ${stats.paths} путей, ${(stats.bytes / 1024 / 1024).toFixed(1)} МиБ, не влезло ${stats.skipped}`
      )
      .join(' | ')

    console.debug(`[streaming] ${summary} | отсечено ${cutoffCount} тел ниже порога`)
  }

  /**
   * Находит актора сценария по имени наблюдаемого тела.
   *
   * Имена не уникальны: кольцо и атмосфера названы так же, как сама планета
   * (восемнадцать пересечений в данных). Перебор идёт по `_map`, а не запросом
   * к ORM, потому что порядок вставки в него структурный: карта строится
   * обходом дерева сценария, где родитель посещается строго до детей, а кольцо
   * и атмосфера — всегда дети своей планеты. Значит первое совпадение по имени
   * гарантированно тело, а не его кольцо. Запрос по таблице такой гарантии не
   * давал: он опирался на порядок объявления в данных.
   */
  private findActorByName(name: string): Actor | undefined {
    for (const actor of this._map.values()) {
      if (actor.getAttribute('name') === name) return actor
    }

    return undefined
  }

  /**
   * Собирает кандидатов: по одному `MapCandidate` на каждый streamable-ресурс
   * каждого наблюдаемого тела. Приоритет тела (радиус/дистанция) считается
   * один раз на актора, а не на карту.
   *
   * Угловая отсечка: тело с `actorPriority < MIN_ACTOR_PRIORITY` (диаметр на
   * экране меньше `config/streaming.minBodyPixels`) НЕ разворачивается в
   * кандидатов вовсе — его текстуры неразличимы, плейсхолдер эквивалентен
   * честной карте. Без отсечки диффузы ВСЕХ наблюдаемых тел (в том числе
   * дальних субпиксельных) конкурируют за бюджет наравне с рельефом
   * ближнего — послойная жадная политика тогда голодает: слой диффузов всей
   * сцены съедает бюджет раньше, чем очередь доходит до slope/detail того,
   * что реально видно (см. `config/streaming.minBodyPixels`, регрессия
   * «тайлы на поверхностях планет пропали»). `cutoffCount` — счётчик
   * отсечённых тел для dev-сводки (`logDecision`).
   *
   * Параллельно перестраивает `pathActors` с нуля — актуальный список
   * владельцев каждого пути в этом пересчёте.
   *
   * Актор может впервые сослаться на путь, который уже резидентен (второе
   * тело общего комплекта карт вошло в зону позже первого) — такой путь
   * никогда не попадёт в `decision.load` повторно (он уже в `loaded`), и без
   * догона материал нового актора остался бы на исходной заглушке навсегда.
   * `catchUp` собирает такие акторы и обновляет их материалы сразу здесь.
   *
   * Путь может лишиться ВСЕХ владельцев разом — тело единственного
   * владельца ушло из наблюдения или упало под угловой порог. Такой путь
   * невидим для `decideStreaming` (тот работает только с текущими
   * `candidates`) и никогда не попал бы в `decision.evict` сам по себе —
   * без явной чистки он завис бы в `loaded` без единого кандидата навсегда.
   * `evictOrphanedPaths` находит такие пути (загружены, но нет записи в
   * свежем `pathActors`) и вытесняет их напрямую, по владельцам из
   * `previousOwners` — снимка `pathActors` ДО перестройки.
   */
  private collectCandidates(): { candidates: MapCandidate[]; cutoffCount: number } {
    const candidates: MapCandidate[] = []
    const previousOwners: Map<string, Set<number>> = new Map(this.pathActors)
    const catchUp: Set<number> = new Set()
    let cutoffCount: number = 0

    this.pathActors.clear()

    for (const record of this.sceneObserver.data.values()) {
      const actor: Actor | undefined = this.findActorByName(record.name)

      if (!actor) continue

      const streamableResources: Resource[] = actor.resources
        .filter((resource: Resource): boolean => resource.getAttribute('lifecycle') === 'streamable')
        .toArray()

      if (!streamableResources.length) continue

      const actorId: number = actor.getAttribute('id')!
      const radiusKm: number = actor.physicalObject?.getAttribute('radius', 0) ?? 0
      const actorPriority: number = toThreeJSUnits(radiusKm) / Math.max(record.distance, MIN_DISTANCE)

      if (actorPriority < MIN_ACTOR_PRIORITY) {
        cutoffCount += 1
        continue
      }

      for (const resource of streamableResources) {
        const path: string = resource.getAttribute('path', '')
        const typeRank: number = mapTypeRank(resource.getAttribute('resourceType') ?? '')

        candidates.push({ actorId, name: record.name, path, typeRank, actorPriority })

        let owners: Set<number> | undefined = this.pathActors.get(path)

        if (!owners) {
          owners = new Set()
          this.pathActors.set(path, owners)
        }

        owners.add(actorId)

        if (this.loaded.has(path) && !previousOwners.get(path)?.has(actorId)) catchUp.add(actorId)
      }
    }

    for (const actorId of catchUp) {
      try {
        this.withActorMaterial(actorId, (material: AbstractShaderMaterial): void => material.updateMaterial())
      } catch {
        // Сломанный материал одного догоняющего актора не должен сорвать сам
        // пересчёт — `closestChange` продолжает работать с candidates дальше.
      }
    }

    this.evictOrphanedPaths(previousOwners)

    return { candidates, cutoffCount }
  }

  /**
   * Вытесняет пути, у которых в свежепостроенном `pathActors` не осталось ни
   * одного владельца, но которые всё ещё числятся `loaded`. Причина не
   * важна для самого вытеснения (актор мог упасть под угловой порог, уйти
   * из наблюдения или сменить набор ресурсов) — важен только факт: путь
   * больше НИКЕМ не запрошен, а `decideStreaming` о нём не узнает, потому
   * что видит только текущих `candidates`.
   *
   * Владелец резолвится по `previousOwners` — снимку `pathActors` ДО
   * перестройки в этом же вызове `collectCandidates`; путь без владельца
   * даже там (не должно происходить в норме — см. `evictPath`) вытесняется
   * фиктивным заявителем: `evictPath` безопасно не находит для него узел
   * сцены и просто чистит бухгалтерию/реестр.
   */
  private evictOrphanedPaths(previousOwners: ReadonlyMap<string, Set<number>>): void {
    for (const path of [...this.loaded]) {
      if (this.pathActors.has(path)) continue

      const typeRank: number = mapTypeRank(Resource.where({ path }).first()?.getAttribute('resourceType') ?? '')
      const owners: Set<number> = previousOwners.get(path) ?? new Set()

      if (!owners.size) {
        this.evictPath({ actorId: -1, name: '', path, typeRank, actorPriority: 0 })
        continue
      }

      for (const actorId of owners) {
        const name: string = this._map.get(actorId)?.getAttribute('name') ?? ''

        this.evictPath({ actorId, name, path, typeRank, actorPriority: 0 })
      }
    }
  }

  /**
   * Освобождает путь БЕЗУСЛОВНО — вызывающий (обычно `closestChange`, по
   * `decision.evict`) уже решил, что путь не нужен НИКОМУ. `decideStreaming`
   * дедуплицирует кандидатов ПО ПУТИ до принятия решения: совместный спрос
   * нескольких тел на общий файл слит в одну запись с максимальным
   * приоритетом среди совладельцев ещё до того, как решается судьба пути.
   * Значит попадание пути в `decision.evict` означает, что дедуплицированный
   * спрос — то есть спрос ВСЕХ текущих совладельцев вместе — не наскрёб
   * места в бюджете, а не то, что один конкретный владелец его разлюбил.
   * Рефкаунт по отдельным владельцам здесь в принципе не нужен: `evictPath`
   * доверяет решению целиком. Ловушка: пересчёт по `pathActors` на месте
   * считал бы НАБЛЮДАЕМЫХ, а не оставшихся в бюджете — шаренный путь тогда
   * не вытесняется никогда.
   *
   * Порядок обязателен: сначала материалы переключаются, и только потом
   * освобождается текстура, иначе кадр между шагами рисуется освобождённой
   * текстурой.
   *
   * Материал сбрасывается на заглушку (`resetMaterial`) только если путь —
   * диффуз (ранг 0): потеря второстепенной карты не убивает тело, оно
   * обязано пережить частичный набор (`updateMaterial`). Трогаются материалы
   * ВСЕХ текущих владельцев пути (`pathActors`), а не только заявителя
   * `candidate` — путь мог быть общим на несколько тел, и все они теряют
   * текстуру одновременно.
   *
   * Материал каждого совладельца трогается в своём `try/catch`: сломанный
   * материал ОДНОГО тела не должен ни оборвать откат остальных совладельцев,
   * ни (что хуже) сорвать бухгалтерию ниже — путь иначе завис бы в `loaded`
   * без текстуры навсегда.
   */
  public evictPath(candidate: MapCandidate): void {
    const owners: ReadonlySet<number> = this.pathActors.get(candidate.path) ?? new Set([candidate.actorId])
    const isDiffuse: boolean = candidate.typeRank === MAP_TYPE_RANK.diffuse

    for (const actorId of owners) {
      try {
        this.withActorMaterial(
          actorId,
          (material: AbstractShaderMaterial): void => (isDiffuse ? material.resetMaterial() : material.updateMaterial()),
          actorId === candidate.actorId ? candidate.name : undefined
        )
      } catch {
        // см. докблок выше
      }
    }

    this.loaded.delete(candidate.path)
    this.loadedAt.delete(candidate.path)
    resourceStorage.deleteTexture(candidate.path)
  }

  /** Владельцы пути для материального фан-аута — из `pathActors`, либо кандидат-заявитель, если путь пришёл в обход `collectCandidates` (прямой вызов). */
  private materialOwners(path: string, fallbackActorId: number): ReadonlySet<number> {
    return this.pathActors.get(path) ?? new Set([fallbackActorId])
  }

  /**
   * Находит рендерабл актора по id и, если он есть в графе сцены с материалом,
   * применяет к нему `fn`. Двойная проверка узла обязательна: актора может не
   * быть в графе сцены, а `hasRenderable` пропускает и `renderable: null`.
   *
   * Имя резолвится через `_map`, а при промахе — через `fallbackName`: заявитель
   * (`candidate.actorId`/`candidate.name`) прямого вызова (тесты, ручное
   * вытеснение) может прийти в обход `collectCandidates`, и тогда `_map` про
   * него ничего не знает — сам кандидат уже несёт своё имя.
   */
  private withActorMaterial(actorId: number, fn: (material: AbstractShaderMaterial) => void, fallbackName?: string): void {
    const name: string | undefined = this._map.get(actorId)?.getAttribute('name') ?? fallbackName

    if (!name) return

    const node = this.scene.getObjectByName(name)

    if (!node || !hasRenderable(node) || node.renderable === null) return

    fn(node.renderable.material as AbstractShaderMaterial)
  }

  /**
   * Грузит один путь и обновляет материалы всех акторов, которые на него
   * ссылаются (`pathActors` — общий файл может показывать несколько тел).
   *
   * Путь из реестра повторно не запрашивается (проверка `resourceStorage`), а
   * гонка конкурентных заявителей закрыта бронью `pathLoads`: один путь —
   * одна бронь на всех совладельцев сразу, кто бы её ни держал.
   *
   * Провал делится по значимости пути: диффуз (ранг 0) без него тело нечего
   * показывать — материал уходит на заглушку (`resetMaterial`). Любая другая
   * карта необязательна: тело переживает её отсутствие, материал просто
   * пересобирается без неё (`updateMaterial`, дефайны молчат).
   *
   * Смена сценария посреди загрузки: `epoch` захватывается до первого `await`,
   * при расхождении результат диспоузится, а `loaded`/`pathActors`/`inFlight`
   * не трогаются вовсе (см. докблок `epoch`).
   *
   * Внешний `try/catch` покрывает весь метод, а не только загрузку: бросок из
   * ORM, из сборки запроса или из `updateMaterial()` оставил бы путь в
   * `loaded` без текстуры и без шанса на повтор.
   */
  private async loadPath(candidate: MapCandidate): Promise<void> {
    const path: string = candidate.path
    const epoch: number = this.epoch

    this.inFlight.add(path)
    this.loaded.add(path)

    try {
      let ok: boolean = true

      try {
        if (!resourceStorage.getTexture(path)) {
          let pending: Promise<LoadResult | null> | undefined = this.pathLoads.get(path)
          let owner: boolean = false

          if (!pending) {
            const resource: Resource | undefined = Resource.where({ path }).first()

            if (resource) {
              pending = this.tryLoad(textureRequestFrom(resource.toJSON() as IResource))
              this.pathLoads.set(path, pending)
              owner = true
            }
          }

          if (pending) {
            const result = await pending

            // Только владелец убирает бронь, и только СВОЮ: сценарий мог
            // смениться, пока мы ждали, `scenario` уже очистил `pathLoads`
            // целиком, а по этому же пути мог появиться НОВЫЙ (уже живой)
            // претендент — сверка на равенство промиса не даёт снять чужую бронь.
            if (owner && this.pathLoads.get(path) === pending) this.pathLoads.delete(path)

            if (this.epoch !== epoch) {
              if (owner && result?.ok && result.texture) result.texture.dispose()

              return
            }

            if (!result || !result.ok || !result.texture) {
              ok = false
            } else if (!resourceStorage.getTexture(path)) {
              // Сосед по той же брони мог зарегистрировать текстуру, пока мы
              // ждали тот же промис — реестр проверяется заново, а не вслепую.
              this.budget.measure(path, result.texture)
              resourceStorage.addTexture(result.texture)
            }
          }
        }
      } finally {
        if (this.epoch === epoch) this.inFlight.delete(path)
      }

      if (this.epoch !== epoch) return

      if (!ok) {
        this.handleLoadFailure(candidate)
        return
      }

      this.loadedAt.set(path, Date.now())

      for (const actorId of this.materialOwners(path, candidate.actorId)) {
        this.withActorMaterial(
          actorId,
          (material: AbstractShaderMaterial): void => material.updateMaterial(),
          actorId === candidate.actorId ? candidate.name : undefined
        )
      }
    } catch {
      // Сценарий мог смениться, пока мы были внутри — устаревший бросок не
      // вправе трогать состояние, которое уже либо очищено сеттером
      // `scenario`, либо принадлежит чужой живой загрузке того же пути (тот
      // же инвариант, что и у обычного провала, см. докблок `epoch`).
      if (this.epoch !== epoch) return

      this.handleLoadFailure(candidate)
    }
  }

  /**
   * Откатывает путь после провала загрузки — полного (провайдер вернул
   * `!ok`) или брошенного (см. `loadPath`): путь уходит в `attempted` и
   * покидает `loaded`. Бухгалтерия применяется БЕЗУСЛОВНО, до касания
   * материалов — путь обязан числиться проваленным, даже если материал у
   * одного из совладельцев сам сломан.
   *
   * Диффуз (ранг 0) без текстуры нечего показывать — материалы владельцев
   * уходят на заглушку. Любая другая карта необязательна — тело переживает
   * её отсутствие, материал только пересобирается без неё.
   *
   * Вызов сюда может прийти уже ИЗ `catch` вокруг брошенного `updateMaterial()`
   * успешного пути (см. `loadPath`) — сломанный материал того же актора
   * бросит и здесь. `try/catch` на актора не даёт этому улететь необработанным
   * из `loadPath` и не даёт одному сломанному материалу оборвать откат
   * остальных совладельцев пути.
   */
  private handleLoadFailure(candidate: MapCandidate): void {
    this.attempted.add(candidate.path)
    this.loaded.delete(candidate.path)

    const isDiffuse: boolean = candidate.typeRank === MAP_TYPE_RANK.diffuse

    for (const actorId of this.materialOwners(candidate.path, candidate.actorId)) {
      try {
        this.withActorMaterial(
          actorId,
          (material: AbstractShaderMaterial): void => (isDiffuse ? material.resetMaterial() : material.updateMaterial()),
          actorId === candidate.actorId ? candidate.name : undefined
        )
      } catch {
        // см. докблок выше
      }
    }
  }
}

export { ResourceObserver }
