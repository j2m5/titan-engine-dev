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
  /** Акторы, чья загрузка провалилась; сбрасывается при выходе из набора. */
  private readonly attempted: Set<number> = new Set()

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
   * Состояние стриминга (`loaded`, `loadedAt`, `inFlight`, `attempted`) обязано
   * обнуляться, потому что разборка сценария освобождает все текстуры разом
   * (`Application.teardown`). Оставшиеся записи выглядели бы для
   * `closestChange` уже загруженными, повторной загрузки не случилось бы, и
   * материалы при возврате на посещённый сценарий остались бы на заглушке из
   * `getTextureOrMake`.
   *
   * `_map` обнуляется, потому что `setMap` дописывает в него через `set` без
   * очистки. Без сброса карта сценария копит чужих акторов из предыдущего
   * сценария.
   */
  public set scenario(scenario: ScenarioConfig | null) {
    this._scenario = scenario
    this._sceneBackground = null
    this.loaded.clear()
    this.loadedAt.clear()
    this.inFlight.clear()
    this.attempted.clear()
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
      (actorId: number): boolean =>
        this.inFlight.has(actorId) || Date.now() - (this.loadedAt.get(actorId) ?? 0) < MIN_RESIDENCY_MS,
      this.attempted,
      (path: string): number | undefined => this.budget.sizeOf(path),
      this.budget.limit()
    )

    // Провал сбрасывается, когда актор покидает набор: сетевой сбой повторится
    // при следующем подлёте, битый путь не даст бесконечного цикла.
    const wanted: Set<number> = new Set(decision.load.map((c: StreamCandidate): number => c.actorId))
    for (const actorId of this.attempted) {
      if (!wanted.has(actorId) && !this.loaded.has(actorId)) this.attempted.delete(actorId)
    }

    for (const candidate of decision.evict) this.evictActor(candidate)
    await Promise.all(decision.load.map((candidate: StreamCandidate): Promise<void> => this.loadActor(candidate)))
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
      const actor: Actor | undefined = Actor.where({ name: record.name }).first()

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
   */
  public evictActor(candidate: StreamCandidate): void {
    const node = this.scene.getObjectByName(candidate.name)

    if (hasRenderable(node)) (node.renderable?.material as AbstractShaderMaterial).resetMaterial()

    for (const path of candidate.paths) {
      resourceStorage.deleteTexture(path)
      this.budget.forget(path)
    }

    this.loaded.delete(candidate.actorId)
    this.loadedAt.delete(candidate.actorId)
  }

  /** Грузит текстуры актора и обновляет его материал. */
  private async loadActor(candidate: StreamCandidate): Promise<void> {
    this.inFlight.add(candidate.actorId)
    this.loaded.add(candidate.actorId)

    let ok: boolean = true

    for (const path of candidate.paths) {
      const resource: Resource | undefined = Resource.where({ path }).first()

      if (!resource) continue

      const result = await this.tryLoad(textureRequestFrom(resource.toJSON() as IResource))

      if (!result || !result.ok || !result.texture) {
        ok = false
        continue
      }

      this.budget.measure(path, result.texture)
      resourceStorage.addTexture(result.texture)
    }

    this.inFlight.delete(candidate.actorId)

    if (!ok) {
      this.attempted.add(candidate.actorId)
      this.loaded.delete(candidate.actorId)

      return
    }

    this.loadedAt.set(candidate.actorId, Date.now())

    const node = this.scene.getObjectByName(candidate.name)

    if (hasRenderable(node)) (node.renderable?.material as AbstractShaderMaterial).updateMaterial()
  }
}

export { ResourceObserver }
