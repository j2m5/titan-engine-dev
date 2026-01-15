import { injectable, inject } from 'inversify'
import dayjs from 'dayjs'
import { ScenarioConfig } from '@/config/scenarios'
import { IActor, IResource } from '@/core/models/types'
import { Resource } from '@/core/models/Resource'
import { Actor } from '@/core/models/Actor'
import { Engine } from '@/core/Engine'
import { ObservableRecord, SceneObserver } from '@/core/services/SceneObserver'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import { TextureManager } from '@/core/services/TextureManager'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { DefaultLoadingManager, Texture } from 'three'
import { engineStore } from '@/ui/mobX/EngineStore'
import { notificationStore } from '@/ui/mobX/NotificationStore'
import { Planet } from '@/core/renderables/Planet'
import { Entity } from '@/core/framework/Entity'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { ResourceItem } from '@/core/services/ResourceManager'
import { Collection } from '@/core/framework/support/Collection'

/**
 * Наблюдатель за ресурсами, отвечающий жизненный цикл ресурсов
 */
@injectable()
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
   * Массив отложенных ресурсов для загрузки
   */
  public deferred: IResource[] = []
  /**
   * Массив различных дополнительных ресурсов
   */
  public misc: IResource[] = []

  /**
   * Текущий сценарий
   */
  private _scenario: ScenarioConfig | null

  /**
   * Карта содержащая все сущности текущего сценария, где ключ - идентификатор актора
   */
  private readonly _map: Map<number, Actor>

  /**
   * @param engine Экземпляр движка
   * @param sceneObserver Наблюдатель за сценой
   * @param cubeMapTextureManager Менеджер текстур кубических карт
   * @param textureManager Стандартный менеджер текстур
   * @param imageBitmapManager Менеджер ImageBitmap
   */
  public constructor(
    @inject('Engine') private engine: Engine,
    @inject('SceneObserver') private sceneObserver: SceneObserver,
    @inject('CubeMapTextureManager') private cubeMapTextureManager: CubeMapTextureManager,
    @inject('TextureManager') private textureManager: TextureManager,
    @inject('ImageBitmapManager') private imageBitmapManager: ImageBitmapManager
  ) {
    this._scenario = null
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
   * Сеттер для текущего сценария
   * @param scenario Новый сценарий
   */
  public set scenario(scenario: ScenarioConfig | null) {
    this._scenario = scenario
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
    await this.cubeMapTextureManager.load(this.cube)
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
    const uniqueDefers: Collection<IResource> = new Collection(this.deferred)
      .whereNotNull('actorId')
      .where('resourceType', 'diffuse')
    const actorIds: number[] = uniqueDefers.map((el: IResource) => el.actorId!).toArray()
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
        const entities: Entity[] = this.engine.entities.filter((entity: Entity) =>
          resources.map((resource: IResource) => resource.actorId).includes(entity.id)
        )

        // извлекает целевые сущности и сбрасывает материал на параметры по умолчанию
        // позволяя WebGL корректно освободить ресурсы
        entities.forEach((entity: Entity): void => {
          const component: Planet = entity.getComponent(Planet)

          component.material.resetMaterial()
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
    const list: string[] = ['sun_glow.png', 'star.png', 'asteroid.jpg', 'night.jpg', 'default.png']

    this.required = Resource.all().whereIn('path', list).toJSON()
  }

  /**
   * Устанавливает дополнительные текстуры для текущего сценария
   */
  private setMisc(): void {
    if (this.scenario) {
      const collection: Collection<Actor> = ModelCollection.make(Array.from(this.map.values()))
      const rings: IResource[] = collection
        .where({ categoryId: 10 })
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

    const data: Partial<IActor> | undefined = Actor.find(this.scenario.galaxyId)?.toJSON()

    if (data && data.id) {
      const root: Actor | null = Actor.find(data.id)

      if (!root) return

      const children: ModelCollection<Actor> = root.children

      const starSystem: Actor | undefined = children.find(this.scenario.rootId)

      this.map.set(root.getAttribute('id'), root)

      if (starSystem) {
        this.map.set(starSystem.getAttribute('id'), starSystem)

        starSystem.children.eachRecursive((actor: Actor): void => {
          this.map.set(actor.getAttribute('id'), actor)
        })
      }
    }
  }

  /**
   * Устанавливает прогресс загрузки текстур
   */
  private setLoadingProgress(): void {
    DefaultLoadingManager.onStart = (url: string, loaded: number, total: number): void => {
      engineStore.setAppLoadingAsset(url)
      engineStore.setAppLoadingProgress(loaded)
      engineStore.setAppLoadingTotal(total)
    }

    DefaultLoadingManager.onProgress = (url: string, loaded: number, total: number): void => {
      engineStore.setAppLoadingAsset(url)
      engineStore.setAppLoadingProgress(loaded)
      engineStore.setAppLoadingTotal(total)
    }

    DefaultLoadingManager.onLoad = (): void => {
      engineStore.setAppLoadingAsset('Loading completed')
      engineStore.setAppLoadingAsset('')
    }

    DefaultLoadingManager.onError = (url: string): void => {
      notificationStore.openNotification({ type: 'error', message: `The error occurred while loading: ${url}` })
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
      const toLoad = actor.resources.map((resource: Resource) => resource.toJSON() as IResource)

      const isNotLoaded = toLoad.filter(
        (resource: IResource) => !this.deferred.some((r: IResource): boolean => r.id === resource.id)
      )

      if (isNotLoaded.isNotEmpty()) {
        this.deferred.push(...isNotLoaded)
        await this.loadDeferredTextures(isNotLoaded.toArray())

        const target: Entity | undefined = this.engine.entities.find(
          (entity: Entity): boolean => entity.id === actor.getAttribute('id')
        )

        const component: Planet | undefined = target?.getComponent(Planet)
        component?.material.updateMaterial()
      }
    }
  }
}

export { ResourceObserver }
