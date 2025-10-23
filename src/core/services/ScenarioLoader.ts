import { DefaultLoadingManager, Scene } from 'three'
import { ScenarioConfig } from '@/config/scenarios'
import { Actor } from '@/core/models/Actor'
import { threeJS } from '@/core/graphic/ThreeJS'
import { getTextureByKey, TextureConfig } from '@/config/textures'
import { Resource } from '@/core/models/Resource'
import { IActor, IResource } from '@/core/models/types'
import { Collection } from '@/core/framework/Memoquent/Collection'
import { engineStore } from '@/ui/mobX/EngineStore'
import { notificationStore } from '@/ui/mobX/NotificationStore'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import { TextureManager } from '@/core/services/TextureManager'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import { MarkerManager } from '@/core/services/MarkerManager'
import { RenderManager } from '@/core/services/RenderManager'
import { inject, injectable } from 'inversify'
import DIServices from '@/core/framework/DI/DIServices'

@injectable()
class ScenarioLoader {
  private _scenario: ScenarioConfig | null
  private readonly _scene: Scene
  private readonly _map: Map<number, Actor>

  public constructor(
    @inject(DIServices.CubeMapTextureManager) private cubeMapTextureManager: CubeMapTextureManager,
    @inject(DIServices.TextureManager) private textureManager: TextureManager,
    @inject(DIServices.ImageBitmapManager) private imageBitmapManager: ImageBitmapManager,
    @inject(DIServices.MarkerManager) private markerManager: MarkerManager,
    @inject(DIServices.RenderManager) private renderManager: RenderManager
  ) {
    this._scenario = null
    this._scene = threeJS.scene
    this._map = new Map()
  }

  public get scenario(): ScenarioConfig | null {
    return this._scenario
  }

  public set scenario(scenario: ScenarioConfig | null) {
    this._scenario = scenario
  }

  public get scene(): Scene {
    return this._scene
  }

  public get map(): Map<number, Actor> {
    return this._map
  }

  public async load(): Promise<void> {
    if (!this.scenario) return

    this.build()

    const cubeMap: IResource[] = Resource.query()
      .where({ resourceType: 'cube' })
      .get()
      .whereIn('id', this.scenario.skybox)
      .toJSON()

    for (const actor of this.map.values()) {
      TextureConfig.BitmapsToLoad.push(...actor.resources.map((resource: Resource) => resource.toJSON() as IResource))
    }

    this.setLoadingProgress()
    await this.imageBitmapManager.loadAll(TextureConfig.BitmapsToLoad)
    await this.textureManager.loadAll(TextureConfig.FilesToLoad)
    await this.cubeMapTextureManager.loadAll([cubeMap])

    this.scene.background = getTextureByKey('cubemaps-scene-main')!

    this.renderManager.setActivePipeline('StarSystemDefault', this.scene)
  }

  public clear(): void {
    this.scene.clear()
    this.map.clear()
    this.markerManager.clear()
    this.imageBitmapManager.removeAll()
  }

  private build(): void {
    if (!this.scenario) return

    const data: Partial<IActor> | undefined = Actor.find(this.scenario.galaxyId)?.toJSON()

    if (data && data.id) {
      const root: Actor | undefined = Actor.find(data.id)?.with('children')

      if (!root) return

      const children: Collection<Actor> = root.children

      const starSystem: Actor | undefined = children.find(this.scenario.rootId)

      this.map.set(root.getAttribute('id'), root)

      if (starSystem) {
        this.map.set(starSystem.getAttribute('id'), starSystem)

        starSystem.children.eachRecursive((actor: Actor): void => {
          this.map.set(actor.getAttribute('id'), actor)
        })
      }

      console.log('star-system', this.map)
    }
  }

  private setLoadingProgress(): void {
    DefaultLoadingManager.onStart = (url: string, loaded: number, total: number): void => {
      engineStore.setAppLoadingAsset(url)
      engineStore.setAppLoadingProgress(loaded)
      engineStore.setAppLoadingTotal(total)
    }

    DefaultLoadingManager.onProgress = (url: string, loaded: number, total: number): void => {
      console.log(url, loaded, total)
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
}

export { ScenarioLoader }
