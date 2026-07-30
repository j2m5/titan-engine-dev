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
import type { StreamCandidate } from '@/core/streaming/types'

/**
 * Сколько миллисекунд актор защищён от вытеснения после загрузки.
 *
 * При рабочем наборе в единицы слотов объект у границы бюджета иначе будет
 * грузиться и вытесняться по кругу. Одна ручка вместо двух порогов, и она не
 * зависит от того, как именно дрожит дистанция.
 */
const MIN_RESIDENCY_MS: number = 10_000

/** Защита от деления на ноль, когда камера внутри тела. */
const MIN_DISTANCE: number = 1e-9

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

  /** Акторы, чьи текстуры в видеопамяти либо в процессе загрузки. */
  private readonly loaded: Set<number> = new Set()
  /** actorId → момент загрузки, для минимальной резидентности. */
  private readonly loadedAt: Map<number, number> = new Map()
  /** Акторы с загрузкой в полёте: их нельзя ни запрашивать, ни вытеснять. */
  private readonly inFlight: Set<number> = new Set()
  /** Акторы, чья загрузка провалилась; сбрасывается, когда актор выходит из `wanted`. */
  private readonly attempted: Set<number> = new Set()
  /**
   * actorId → пути, за которые актор отвечает — для проверки совместного
   * владения путём. Путь реестра текстур ключуется по пути ресурса, а не по
   * актору: несколько акторов одного сценария могут разделять один и тот же
   * файл (например, Korriban I–VII делят и диффуз, и bump). Без этой карты
   * вытеснение одного из них освобождало бы текстуру, которую показывает
   * другой, а загрузка второго задваивала бы уже резидентный путь.
   */
  private readonly actorPaths: Map<number, string[]> = new Map()
  /**
   * Счётчик сбросов сценария. `loadActor` захватывает значение до первого
   * `await`; если оно изменилось к моменту, когда путь догрузился, — сценарий
   * сменился посреди загрузки, и результат отбрасывается вместо регистрации
   * в уже разобранном реестре.
   *
   * Устаревший вызов НЕ имеет права трогать `loaded`/`actorPaths`/`inFlight`
   * по одному только `actorId`, когда обнаруживает несовпадение эпохи: та же
   * запись под тем же ключом может уже принадлежать свежей (живой) загрузке
   * того же актора, начатой уже в новой эпохе (раунд ревью 2, Critical —
   * найдено на реальном сценарии: устаревший резолв Korriban II снимал
   * пометки живой загрузки того же актора, и последующее вытеснение
   * освобождало разделяемый диффуз, который Korriban I ещё показывал).
   * Поэтому во всех местах, где обнаружено расхождение эпох, состояние
   * просто НЕ трогается: либо сеттер `scenario` уже очистил его (наш случай),
   * либо в нём живая запись, которую трогать нельзя.
   */
  private epoch: number = 0
  /**
   * Путь → промис загрузки, ещё не завершившейся В ЭТОМ ЦИКЛЕ. Нужен, чтобы
   * два актора одного сценария, разделяющие путь (Korriban I–VII) и
   * загружаемые ОДНОВРЕМЕННО (`Promise.all` по `decision.load` одного
   * пересчёта), не задваивали сетевой запрос: проверка реестра
   * (`resourceStorage.getTexture`) не спасает — в момент проверки путь ещё
   * не зарегистрирован НИКЕМ, потому что первый заявитель тоже ещё грузит
   * его (round 2 Important — иначе второй Texture-объект остаётся в реестре
   * недостижимым и никогда не диспоузится).
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
   * Накопленное за прошлый сценарий сбрасывается здесь, а не в помощнике:
   * `setMap` при `scenario === null` выходит сразу, то есть выход в меню не
   * очистил бы ничего.
   *
   * Состояние стриминга (`loaded`, `loadedAt`, `inFlight`, `attempted`,
   * `actorPaths`) обязано обнуляться, потому что разборка сценария освобождает
   * все текстуры разом (`Application.teardown`). Оставшиеся записи выглядели
   * бы для `closestChange` уже загруженными, повторной загрузки не случилось
   * бы, и материалы при возврате на посещённый сценарий остались бы на
   * заглушке из `getTextureOrMake`.
   *
   * `epoch` увеличивается, чтобы загрузка, начатая в прошлом сценарии, но ещё
   * не завершившаяся (await не успел резолвиться), опознала смену по выходу
   * из `await` и не записала результат в уже разобранное состояние.
   *
   * `pathLoads` тоже обязан очищаться. Без очистки свежая (уже в новой
   * эпохе) загрузка того же пути нашла бы там промис устаревшего вызова и
   * стала бы его "соседом" по общей загрузке — а когда устаревший вызов
   * позже обнаружит несовпадение эпохи и диспоузит СВОЙ результат (см.
   * `loadActor`), свежий вызов зарегистрировал бы уже диспоузнутую текстуру,
   * ничего об этом не зная. Очистка не отменяет уже идущий реальный сетевой
   * запрос — просто гарантирует, что НИКТО новый к нему больше не
   * присоединится.
   *
   * `_map` обнуляется, потому что `setMap` дописывает в него через `set` без
   * очистки. Без сброса карта сценария копит чужих акторов из предыдущего
   * сценария.
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
    this.actorPaths.clear()
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
   * `TextureProvider` бросает нарочно, когда ни одна стратегия не подходит
   * форме запроса (опечатка в расширении, кубмапа не из шести граней) — это
   * ошибка данных, а не сбой сети, который сам провайдер уже маскирует
   * заглушкой. Но выше по цепочке нет обработчика: `loadInto` вызывает
   * `load` внутри `Promise.all`, `Application.run` ждёт `loadPrimaryTextures`
   * без try, `EngineStore.setScenario` ждёт `app.run` без try. Без перехвата
   * здесь отказ означал бы, что `setAppLoadingStatus(false)` никогда не
   * выполнится — приложение зависает на экране загрузки без сообщения.
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

  /**
   * Отбирает резидентные ресурсы по флагу в данных.
   *
   * Раньше тот же набор задавался тремя путями сразу: захардкоженным списком в
   * `setRequiredTextures`, выборкой колец по `categoryId: 6` в `setMisc` и
   * запросом кубмап. Код и данные дублировали друг друга и разъехались —
   * кольца Adriana и Darkness оказались помечены `streamable` и грузились лишь
   * потому, что `setMisc` брал ресурсы колец скопом, не глядя на флаг.
   */
  private setResidentTextures(): void {
    this.resident = Resource.all()
      .filter(
        (resource: Resource): boolean =>
          resource.getAttribute('lifecycle') === 'resident' && resource.getAttribute('resourceType') !== 'cube'
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
    const candidates: StreamCandidate[] = this.collectCandidates()
    const decision = decideStreaming(
      candidates,
      this.loaded,
      // Два разных условия защищают ДВА разных момента жизни актора, а не
      // дублируют друг друга: `inFlight` пинит актора, который грузится
      // ВПЕРВЫЕ и ещё ни разу не завершался успешно — до первого успеха
      // `loadedAt` для него не выставлен ни разу, так что второе условие тут
      // всегда ложно. `loadedAt`-порог пинит УЖЕ загруженного актора на
      // MIN_RESIDENCY_MS после успеха — к этому моменту `inFlight` для него
      // уже снят. Без `inFlight` актор, чей приоритет упал, пока он ещё
      // грузится в первый раз, вошёл бы в `decision.evict`: `evictActor`
      // разобрал бы его учёт, а сама загрузка, уже идущая, дозаписала бы
      // результат в снесённое состояние.
      (actorId: number): boolean =>
        this.inFlight.has(actorId) || Date.now() - (this.loadedAt.get(actorId) ?? 0) < MIN_RESIDENCY_MS,
      this.attempted,
      (path: string): number | undefined => this.budget.sizeOf(path),
      this.budget.limit()
    )

    // Провал снимается только когда актор перестаёт ЗАСЛУЖИВАТЬ резидентность
    // по приоритету и бюджету (decision.wanted) — а не когда его не видно в
    // decision.load, где исключённый (=attempted) и так никогда не появится:
    // то прежнее условие снимало блокировку на первом же цикле после провала,
    // и битый путь ретраился бы бесконечно (Critical 2 раунда ревью).
    for (const actorId of this.attempted) {
      if (!decision.wanted.has(actorId)) this.attempted.delete(actorId)
    }

    for (const candidate of decision.evict) this.evictActor(candidate)
    await Promise.all(decision.load.map((candidate: StreamCandidate): Promise<void> => this.loadActor(candidate)))
  }

  /**
   * Находит актора сценария по имени наблюдаемого тела.
   *
   * Имена НЕ уникальны в рамках сценария: кольцо и атмосфера планеты названы
   * ТАК ЖЕ, как сама планета (Saturn — акторы 11/39/50, Adriana — 64/77/79,
   * восемнадцать имён пересекаются в данных всего). Раньше резолв шёл через
   * `Actor.where({ name }).first()` — запрос по ВСЕЙ таблице акторов без
   * учёта сценария и дерева, результат которого — первый элемент в порядке
   * объявления в исходных данных. Он совпадал с планетой только потому, что
   * в каждом из 18 случаев планета объявлена РАНЬШЕ своих кольца/атмосферы
   * (у неё меньший id) — совпадение данных, не гарантия: перегенерация с
   * другим порядком id вернула бы кольцо (только `resident`-текстура) или
   * атмосферу (вообще без ресурсов) — и планета осталась бы с вечной
   * заглушкой молча, никем не замеченная.
   *
   * `this._map` строится обходом дерева СЦЕНАРИЯ (`setMap` → `children.
   * eachRecursive`), где родитель посещается СТРОГО до своих детей (см.
   * `ModelCollection.eachRecursive`: колбэк вызывается до рекурсии в
   * `children`), а `Map` перебирается в порядке вставки. Кольцо и атмосфера
   * всегда дети ИМЕННО той планеты, чьё имя разделяют, — не её соседи по
   * дереву и не самостоятельные тела с тем же именем где-то ещё. Значит
   * первое совпадение по имени при переборе `this._map.values()` —
   * структурно, а не по счастливой нумерации, — всегда предок (планета,
   * звезда или чёрная дыра), а не потомок (кольцо/атмосфера). Заодно уходит
   * ORM-запрос на каждое наблюдаемое тело при каждой смене камеры — актор
   * уже в памяти, наполненной `setMap` при выборе сценария.
   */
  private findActorByName(name: string): Actor | undefined {
    for (const actor of this._map.values()) {
      if (actor.getAttribute('name') === name) return actor
    }

    return undefined
  }

  /**
   * Собирает кандидатов: тела из SceneObserver.data, у которых есть
   * стримируемые ресурсы. Приоритет — радиус, делённый на расстояние.
   *
   * Радиус в данных в километрах, дистанция в ObservableRecord уже в
   * three-единицах, поэтому радиус переводится — иначе отношение бессмысленно.
   */
  private collectCandidates(): StreamCandidate[] {
    const candidates: StreamCandidate[] = []

    for (const record of this.sceneObserver.data.values()) {
      const actor: Actor | undefined = this.findActorByName(record.name)

      if (!actor) continue

      const paths: string[] = actor.resources
        .filter((resource: Resource): boolean => resource.getAttribute('lifecycle') === 'streamable')
        .map((resource: Resource): string => resource.getAttribute('path', ''))
        .toArray()

      if (!paths.length) continue

      const radiusKm: number = actor.physicalObject?.getAttribute('radius', 0) ?? 0

      candidates.push({
        actorId: actor.getAttribute('id')!,
        name: record.name,
        priority: toThreeJSUnits(radiusKm) / Math.max(record.distance, MIN_DISTANCE),
        paths
      })
    }

    return candidates
  }

  /**
   * Освобождает текстуры актора.
   *
   * Порядок обязателен: сначала материал переключается на резидентную
   * заглушку, и только потом текстуры освобождаются. Иначе кадр между шагами
   * рисуется освобождённой текстурой. Трогается ТОЛЬКО выселяемый актор —
   * прежний код сбрасывал материалы всех планет сцены разом.
   *
   * `getObjectByName` возвращает `Object3D | undefined` — актора может не
   * быть в графе сцены (снят, ещё не создан), и `hasRenderable(undefined)`
   * разыменовывает аргумент и бросает. Проверка `node &&` обязательна.
   *
   * `hasRenderable` проверяет только, что свойство `renderable` СУЩЕСТВУЕТ
   * (`!== undefined`) — оно возвращает true и для `{ renderable: null }`.
   * Без явного `node.renderable !== null` `node.renderable?.material`
   * окажется `undefined`, и `.resetMaterial()` на нём бросит — бросок внутри
   * `evictActor` прерывает цикл `for (const candidate of decision.evict)` в
   * `closestChange`, отменяя вытеснение ВСЕХ оставшихся кандидатов этого
   * пересчёта. `SceneManager.ts:70` уже страхуется тем же двойным условием —
   * здесь оно обязано быть идентичным.
   *
   * Пути не удаляются безусловно: `pathStillReferenced` проверяет, ссылается
   * ли на этот же путь другой ЗАГРУЖЕННЫЙ актор (Critical 1 раунда ревью —
   * несколько акторов сценария могут делить один файл текстуры), и если да,
   * путь остаётся резидентным — вытесняется только собственный учёт актора.
   */
  public evictActor(candidate: StreamCandidate): void {
    const node = this.scene.getObjectByName(candidate.name)

    if (node && hasRenderable(node) && node.renderable !== null) {
      (node.renderable.material as AbstractShaderMaterial).resetMaterial()
    }

    this.loaded.delete(candidate.actorId)
    this.loadedAt.delete(candidate.actorId)
    this.actorPaths.delete(candidate.actorId)

    for (const path of candidate.paths) {
      if (this.pathStillReferenced(path)) continue

      resourceStorage.deleteTexture(path)
    }
  }

  /**
   * Путь всё ещё нужен, если на него ссылается какой-то ДРУГОЙ актор,
   * который сейчас в `loaded`. Вызывать ПОСЛЕ того, как выселяемый/
   * откатываемый актор убран из `loaded`/`actorPaths` — иначе он сам себя
   * посчитает «другим» владельцем.
   */
  private pathStillReferenced(path: string): boolean {
    for (const actorId of this.loaded) {
      if (this.actorPaths.get(actorId)?.includes(path)) return true
    }

    return false
  }

  /**
   * Грузит текстуры актора и обновляет его материал.
   *
   * Путь, уже присутствующий в реестре (Critical 1 — путь могут разделять
   * несколько акторов сценария, например диффуз и bump Korriban I–VII),
   * повторно не запрашивается: сеть не дёргается дважды, а актор всё равно
   * записывается его владельцем в `actorPaths` — иначе позже некому будет
   * защитить путь при вытеснении первого владельца.
   *
   * Реестра недостаточно, если оба разделяющих путь актора попали в ОДИН
   * `decision.load` одного и того же пересчёта: `Promise.all` запускает их
   * `loadActor` конкурентно, и оба успевают проверить реестр ДО того, как
   * первый из них там что-либо зарегистрирует (round 2 Important). Поэтому
   * путь дополнительно бронируется в `pathLoads` — карте путь → промис ещё
   * не завершившейся загрузки; второй заявитель находит там промис первого
   * и ждёт тот же результат вместо повторного сетевого запроса. После общего
   * ожидания РЕЕСТР перепроверяется ещё раз — тот, кто получил управление
   * первым (обычно владелец промиса), уже мог зарегистрировать текстуру,
   * пока второй ждал ту же самую загрузку.
   *
   * Частичный провал (один путь не загрузился, остальные — да) откатывает
   * актора целиком: уже зарегистрированные пути ЭТОГО вызова освобождаются
   * (если на них не ссылается кто-то ещё из `loaded`, см.
   * `pathStillReferenced`), актор целиком уходит в `attempted`. Альтернатива
   * — оставить актора в `loaded` «деградировавшим» — отклонена: `loaded`
   * тогда перестаёт означать «показывает то, что должен», а деградировавший
   * актор либо никогда не получит второй попытки, пока остаётся в зоне
   * приоритета (`decideStreaming` не грузит уже `loaded`), либо потребовался
   * бы отдельный механизм ретрая частичных провалов. Откат проще и
   * переиспользует уже существующий retry-путь полного провала.
   *
   * Сценарий может смениться, пока путь ещё грузится: `epoch` захватывается
   * до первого `await`, и если он изменился к моменту, когда путь догрузился,
   * результат отбрасывается (текстура диспоузится, если успела прийти и мы
   * ей владеем). `loaded`/`actorPaths` при этом НЕ трогаются вовсе — см.
   * докблок поля `epoch`: устаревший вызов не вправе решать, что там сейчас
   * лежит, — оно уже принадлежит либо очищенному сценарию, либо чужой живой
   * загрузке того же актора.
   *
   * Бухгалтерия `inFlight` обёрнута в `try/finally` и тоже огорожена сверкой
   * эпохи: снимать пометку можно только если мы всё ещё в своей эпохе —
   * иначе можно снять пометку у чужой, живой загрузки того же актора.
   *
   * Внешний `try/catch` — граница ошибки на весь метод, не только на цикл
   * загрузки: `tryLoad` гасит ошибки ПРОВАЙДЕРА (сеть, форма запроса), но
   * не всё тело `loadActor` обёрнуто им. Бросок из ORM (`Resource.where`),
   * из сборки запроса (`textureRequestFrom`) или из `updateMaterial()` после
   * успешной загрузки раньше улетал необработанным отказом из `Promise.all`
   * в `closestChange`, а актор оставался в `loaded` без единой текстуры —
   * `decideStreaming` не грузит уже `loaded`, значит повторного запроса
   * никогда бы не случилось. Катч переводит такой бросок в тот же откат,
   * что и обычный провал (`rollbackFailedLoad`) — актор возвращается в
   * `attempted` и получит второй шанс, как только перестанет заслуживать
   * резидентности и снова войдёт в неё (см. `closestChange`).
   */
  private async loadActor(candidate: StreamCandidate): Promise<void> {
    const epoch: number = this.epoch

    this.inFlight.add(candidate.actorId)
    this.loaded.add(candidate.actorId)
    this.actorPaths.set(candidate.actorId, candidate.paths)

    try {
      let ok: boolean = true

      try {
        for (const path of candidate.paths) {
          if (resourceStorage.getTexture(path)) continue

          let pending: Promise<LoadResult | null> | undefined = this.pathLoads.get(path)
          let owner: boolean = false

          if (!pending) {
            const resource: Resource | undefined = Resource.where({ path }).first()

            if (!resource) continue

            pending = this.tryLoad(textureRequestFrom(resource.toJSON() as IResource))
            this.pathLoads.set(path, pending)
            owner = true
          }

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
            continue
          }

          // Сосед по той же брони мог зарегистрировать текстуру, пока мы ждали
          // тот же промис — реестр проверяется заново, а не вслепую.
          if (resourceStorage.getTexture(path)) continue

          this.budget.measure(path, result.texture)
          resourceStorage.addTexture(result.texture)
        }
      } finally {
        if (this.epoch === epoch) this.inFlight.delete(candidate.actorId)
      }

      if (this.epoch !== epoch) return

      if (!ok) {
        this.rollbackFailedLoad(candidate)
        return
      }

      this.loadedAt.set(candidate.actorId, Date.now())

      const node = this.scene.getObjectByName(candidate.name)

      if (node && hasRenderable(node) && node.renderable !== null) {
        (node.renderable.material as AbstractShaderMaterial).updateMaterial()
      }
    } catch {
      // Сценарий мог смениться, пока мы были внутри — устаревший бросок не
      // вправе трогать состояние, которое уже либо очищено сеттером
      // `scenario`, либо принадлежит чужой живой загрузке того же актора
      // (тот же инвариант, что и у обычного провала, см. докблок `epoch`).
      if (this.epoch !== epoch) return

      this.rollbackFailedLoad(candidate)
    }
  }

  /**
   * Откатывает актора после провала загрузки — полного (провайдер вернул
   * `!ok`) или брошенного (см. `loadActor`): актор уходит в `attempted` и
   * покидает `loaded`, а его пути освобождаются из реестра, если на них не
   * ссылается кто-то ещё из `loaded` (`pathStillReferenced` — Critical 1,
   * несколько акторов сценария могут делить один файл текстуры).
   */
  private rollbackFailedLoad(candidate: StreamCandidate): void {
    this.attempted.add(candidate.actorId)
    this.loaded.delete(candidate.actorId)
    this.actorPaths.delete(candidate.actorId)

    for (const path of candidate.paths) {
      if (this.pathStillReferenced(path)) continue

      resourceStorage.deleteTexture(path)
    }
  }
}

export { ResourceObserver }
