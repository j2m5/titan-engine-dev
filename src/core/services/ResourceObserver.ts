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
   * actorId → пути, за которые актор отвечает. Реестр текстур ключуется по
   * пути, а акторы могут делить файл (Korriban I–VII делят диффуз и bump), так
   * что без проверки совместного владения вытеснение одного освобождало бы
   * текстуру, которую показывает другой.
   */
  private readonly actorPaths: Map<number, string[]> = new Map()
  /**
   * Счётчик сбросов сценария. `loadActor` захватывает значение до первого
   * `await`: если к моменту догрузки оно изменилось, сценарий сменился посреди
   * загрузки и результат отбрасывается, а не пишется в разобранный реестр.
   *
   * При расхождении эпох устаревший вызов НЕ трогает состояние по одному
   * `actorId`: под тем же ключом может уже лежать живая запись новой эпохи.
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
    const candidates: StreamCandidate[] = this.collectCandidates()
    const decision = decideStreaming(
      candidates,
      this.loaded,
      // Условия защищают разные моменты жизни актора и не дублируют друг друга:
      // `inFlight` пинит того, кто грузится впервые (до первого успеха
      // `loadedAt` не выставлен), а порог по `loadedAt` — уже загруженного.
      // Без `inFlight` актор, потерявший приоритет прямо во время первой
      // загрузки, попал бы в вытеснение, а загрузка дописала бы результат в
      // снесённое состояние
      (actorId: number): boolean =>
        this.inFlight.has(actorId) || Date.now() - (this.loadedAt.get(actorId) ?? 0) < MIN_RESIDENCY_MS,
      this.attempted,
      (path: string): number | undefined => this.budget.sizeOf(path),
      this.budget.limit()
    )

    // Провал снимается по `wanted`, а не по `load`: исключённый актор в `load`
    // не появится никогда, и битый путь ретраился бы бесконечно
    for (const actorId of this.attempted) {
      if (!decision.wanted.has(actorId)) this.attempted.delete(actorId)
    }

    for (const candidate of decision.evict) this.evictActor(candidate)
    await Promise.all(decision.load.map((candidate: StreamCandidate): Promise<void> => this.loadActor(candidate)))
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
   * Порядок обязателен: сначала материал переключается на резидентную заглушку
   * и только потом освобождаются текстуры, иначе кадр между шагами рисуется
   * освобождённой текстурой. Трогается только выселяемый актор.
   *
   * Двойная проверка узла обязательна: актора может не быть в графе сцены, а
   * `hasRenderable` пропускает и `renderable: null`. Бросок отсюда прервал бы
   * цикл вытеснения и отменил всех оставшихся кандидатов пересчёта.
   *
   * Пути удаляются только если на них не ссылается другой загруженный актор:
   * акторы сценария могут делить один файл.
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
   * Путь из реестра повторно не запрашивается, но актор всё равно
   * записывается его владельцем в `actorPaths` — иначе некому будет защитить
   * путь при вытеснении первого владельца.
   *
   * Реестра мало, когда оба разделяющих путь актора попали в один пересчёт:
   * `Promise.all` запускает их конкурентно, и оба проверяют реестр до первой
   * регистрации. Поэтому путь бронируется в `pathLoads`, а после общего
   * ожидания реестр перепроверяется — владелец промиса мог успеть.
   *
   * Частичный провал откатывает актора целиком: иначе `loaded` перестаёт
   * означать «показывает то, что должен», а деградировавший актор второй
   * попытки не получит — `decideStreaming` не грузит уже загруженное.
   *
   * Смена сценария посреди загрузки: `epoch` захватывается до первого `await`,
   * при расхождении результат диспоузится, а `loaded`/`actorPaths`/`inFlight`
   * не трогаются вовсе (см. докблок `epoch`).
   *
   * Внешний `try/catch` покрывает весь метод, а не только загрузку: бросок из
   * ORM, из сборки запроса или из `updateMaterial()` оставил бы актора в
   * `loaded` без единой текстуры и без шанса на повтор.
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
   * ссылается кто-то ещё из `loaded` (`pathStillReferenced`): акторы
   * сценария могут делить один файл.
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
