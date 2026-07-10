import dayjs from 'dayjs'
import { ScenarioConfig } from '@/config/scenarios'
import { IActorBoundResource, IResource } from '@/core/models/types'
import { Resource } from '@/core/models/Resource'
import { Actor } from '@/core/models/Actor'
import { ObservableRecord, SceneObserver } from '@/core/services/SceneObserver'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import { TextureManager } from '@/core/services/TextureManager'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { CubeTexture, DefaultLoadingManager, Object3D, Texture } from 'three'
import { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import { NotificationSink } from '@/core/ports/NotificationSink'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { ResourceItem } from '@/core/services/ResourceManager'
import { Collection } from '@/core/framework/support/Collection'
import { threeJS } from '@/core/graphic/ThreeJS'
import { hasRenderable } from '@/core/services/SceneManager'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'

/**
 * Наблюдатель за ресурсами, отвечающий жизненный цикл ресурсов
 */
class ResourceObserver {
  /**
   * Массив ресурсов кубических карт для фона сцены
   */
  public cube: IResource[] = []
  /**
   * Массив обязательных ресурсов для загрузки
   */
  public required: IResource[] = []
  /**
   * Массив отложенных ресурсов для загрузки (с привязкой к актору,
   * прикрепляемой в closestChange — нужна для группировки при выгрузке)
   */
  public deferred: IActorBoundResource[] = []
  /**
   * Массив различных дополнительных ресурсов
   */
  public misc: IResource[] = []

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
   * @param sceneObserver Наблюдатель за сценой
   * @param cubeMapTextureManager Менеджер текстур кубических карт
   * @param textureManager Стандартный менеджер текстур
   * @param imageBitmapManager Менеджер ImageBitmap
   */
  public constructor(
    private sceneObserver: SceneObserver,
    private cubeMapTextureManager: CubeMapTextureManager,
    private textureManager: TextureManager,
    private imageBitmapManager: ImageBitmapManager,
    private loadingProgress: LoadingProgressReporter,
    private notifications: NotificationSink
  ) {
    this._scenario = null
    this._sceneBackground = null
    this._map = new Map()
    this.sceneObserver.subscribe('ClosestChange', this.closestChange)
    this.setRequiredTextures()
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
   */
  public set scenario(scenario: ScenarioConfig | null) {
    this._scenario = scenario
    this._sceneBackground = null
    this.setMap()
    this.setCubeTextures()
    this.setMisc()
  }

  /**
   * Геттер для карты сценария
   */
  public get map(): Map<number, Actor> {
    return this._map
  }

  /**
   * Загружает основные текстуры, необходимые для работы сценария
   */
  public async loadPrimaryTextures(): Promise<void> {
    this.setLoadingProgress()
    this._sceneBackground = (await this.cubeMapTextureManager.load(this.cube)) ?? null
    await this.textureManager.loadAll(this.required)
    await this.imageBitmapManager.loadAll(this.misc)
  }

  /**
   * Загружает отложенные текстуры
   * @param resources Массив ресурсов для загрузки
   */
  public async loadDeferredTextures(resources: IResource[]): Promise<void> {
    await this.imageBitmapManager.loadAll(resources)
  }

  /**
   * Выгружает текстуры определенные как неиспользуемые в данный момент времени
   */
  private releaseUnusedTextures(): void {
    // сколько отдаленных объектов нужно получить для удаления их текстур
    const minCountFarthest: number = 3

    // определение для каких объектов текстуры уже были загружены
    // именно их и надо прослушивать на предмет необходимости удаления текстур
    const uniqueDefers: Collection<IActorBoundResource> = new Collection(this.deferred)
      .whereNotNull('actorId')
      .where('resourceType', 'diffuse')
    const actorIds: number[] = uniqueDefers.map((el: IActorBoundResource) => el.actorId!).toArray()
    const preparedActors: string[] = Actor.query().whereIn('id', actorIds).pluck('name')
    const filterPreparedActors: ObservableRecord[] = Array.from(this.sceneObserver.data.values()).filter(
      (record: ObservableRecord) => preparedActors.includes(record.name)
    )
    // получает minCountFarthest (по умолчанию 3) наиболее отдаленных объекта, возвращая массив их имен
    // вторым параметром принимает фильтрованный массив ObservableRecord
    // в котором остаются только те элементы для которых текстуры уже были загружены
    const farthestObjects: string[] = this.sceneObserver
      .calculateFarthestObjects(minCountFarthest, filterPreparedActors)
      .map((object: ObservableRecord) => object.name)

    // если фактическое количество объектов с загруженными текстурами меньше minCountFarthest
    // завершается выполнение метода, поскольку нет необходимости удалять текстуры в данный момент
    if (filterPreparedActors.length <= minCountFarthest) return

    // извлекает коллекцию ресурсов
    const resources: IResource[] = Actor.all()
      .where('categoryId', 7)
      .whereIn('name', farthestObjects)
      .flatMap((actor: Actor) => actor.resources.toJSON())
      .toArray()
    // с помощью коллекции ресурсов извлекает текстуры из хранилища по имени (относительный путь = имя)
    const textures: Collection<Texture> = resourceStorage.textures.whereIn(
      'name',
      resources.map((resource: IResource) => resource.path)
    )

    textures.each((texture: Texture): void => {
      // извлекает объект с мета-данными в поле userData текстуры
      const resource: ResourceItem | undefined = texture.userData.resource as ResourceItem | undefined
      // проверяет на наличие мета-данных, проверяет чтобы loadedAt и expiredAt отличались
      // loadedAt и expiredAt равны если lifetime ресурса установлен как 0, это означает текстура имеет infinite lifetime
      // основная проверка на истечение lifetime ресурса, если меньше текущего времени - нужно удалять
      if (resource && resource.loadedAt !== resource.expiredAt && resource.expiredAt < dayjs()) {
        const objects = threeJS.scene.getObjectsByUserDataProperty('type', 'planet')

        // извлекает целевые сущности и сбрасывает материал на параметры по умолчанию
        // позволяя WebGL корректно освободить ресурсы
        objects.forEach((object: Object3D): void => {
          if ('material' in object && object.material instanceof AbstractShaderMaterial) {
            object.material.resetMaterial()
          }
        })

        // удаление как из хранилища так и с GPU
        resourceStorage.deleteTexture(texture.name)

        // после удаления нужно также удалить из массива отложенных ресурсов, чтобы можно было загрузить заново
        const deferIndex: number = this.deferred.findIndex(
          (resource: IResource): boolean => resource.path === texture.name
        )

        if (deferIndex !== -1) this.deferred.splice(deferIndex, 1)
      }
    })
  }

  /**
   * Устанавливает текстуры кубических карт для текущего сценария
   */
  private setCubeTextures(): void {
    if (this.scenario) {
      this.cube = Resource.query().where({ resourceType: 'cube' }).get().whereIn('id', this.scenario.skybox).toJSON()
    }
  }

  /**
   * Устанавливает обязательные текстуры для загрузки
   */
  private setRequiredTextures(): void {
    const list: string[] = [
      'star.png',
      'asteroid.jpg',
      'asteroid_bump.jpg',
      'night.jpg',
      'default.png',
      'sun.png',
      'round.png',
      'asteroids/rock_boulder_dry_diff_2k.jpg',
      'asteroids/rock_boulder_dry_nor_gl_2k.jpg',
      'asteroids/rock_boulder_dry_arm_2k.jpg'
    ]

    this.required = Resource.all().whereIn('path', list).toJSON()
  }

  /**
   * Устанавливает дополнительные текстуры для текущего сценария
   */
  private setMisc(): void {
    if (this.scenario) {
      const collection: Collection<Actor> = ModelCollection.make(Array.from(this.map.values()))
      const rings: IResource[] = collection
        .where({ categoryId: 6 })
        .flatMap((actor: Actor) => actor.resources.map((resource: Resource) => resource.toJSON() as IResource))
        .toArray()

      this.misc.push(...rings)
    }
  }

  /**
   * Устанавливает карту для текущего сценария
   */
  private setMap(): void {
    if (!this.scenario) return

    const root: Actor | null = Actor.find(this.scenario.rootId)

    if (!root) return

    this.map.set(root.getAttribute('id'), root)

    root.children.eachRecursive((actor: Actor): void => {
      this.map.set(actor.getAttribute('id'), actor)
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
   * Обработчик события изменения ближайшего объекта
   * @param event Запись наблюдаемого объекта
   */
  private closestChange = async (event: ObservableRecord): Promise<void> => {
    this.releaseUnusedTextures()

    const actor: Actor | undefined = Actor.where({ name: event.name }).first()

    if (actor && actor.resources.isNotEmpty()) {
      // связь актор-ресурс идёт через пивот, поэтому actorId прикрепляется здесь —
      // в единственной точке, где контекст актора известен
      const toLoad = actor.resources.map(
        (resource: Resource): IActorBoundResource => ({
          ...(resource.toJSON() as IResource),
          actorId: actor.getAttribute('id')
        })
      )

      const isNotLoaded = toLoad.filter(
        (resource: IActorBoundResource) => !this.deferred.some((r: IActorBoundResource): boolean => r.id === resource.id)
      )

      if (isNotLoaded.isNotEmpty()) {
        this.deferred.push(...isNotLoaded)
        await this.loadDeferredTextures(isNotLoaded.toArray())

        const node = threeJS.scene.getObjectByName(actor.getAttribute('name'))

        if (hasRenderable(node)) (node.renderable?.material as AbstractShaderMaterial).updateMaterial()
      }
    }
  }
}

export { ResourceObserver }
