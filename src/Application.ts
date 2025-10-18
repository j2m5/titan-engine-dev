import { AppState } from '@/core/services/states/AppState'
import { Engine } from '@/core/Engine'
import { System } from '@/core/framework/System'
import { RenderSystem } from '@/core/systems/RenderSystem'
import { EntitySystem } from '@/core/systems/EntitySystem'
import { RenderManager } from '@/core/services/RenderManager'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import { TextureManager } from '@/core/services/TextureManager'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import { SceneManager } from '@/core/services/SceneManager'
import { MarkerManager } from '@/core/services/MarkerManager'
import { engineStore } from '@/ui/mobX/EngineStore'
import { notificationStore } from '@/ui/mobX/NotificationStore'
import { DefaultLoadingManager } from 'three'
import { TextureConfig } from '@/config/textures'
import { inject, injectable } from 'inversify'
import DIServices from '@/core/framework/DI/DIServices.ts'

@injectable()
class Application {
  public state: AppState | null

  public constructor(
    @inject(DIServices.Engine) public engine: Engine,
    @inject(DIServices.RenderManager) public renderManager: RenderManager,
    @inject(DIServices.CubeMapTextureManager) public cubeMapTextureManager: CubeMapTextureManager,
    @inject(DIServices.TextureManager) public textureManager: TextureManager,
    @inject(DIServices.ImageBitmapManager) public imageBitmapManager: ImageBitmapManager,
    @inject(DIServices.SceneManager) public sceneManager: SceneManager,
    @inject(DIServices.MarkerManager) public markerManager: MarkerManager
  ) {
    this.state = null
    this.sceneManager.setContext(this)
  }

  public async setState(state: AppState): Promise<void> {
    this.engine.dispose()

    this.state?.clear()
    this.state = state
    this.state.setContext(this)

    this.setLoadingProgress()

    await this.textureManager.loadAll(TextureConfig.FilesToLoad)
    await this.state.load()

    const renderSystem: System = new RenderSystem(this.state, this.renderManager)
    const entitySystem: System = new EntitySystem(this.state)

    this.engine.addSystem(renderSystem)
    this.engine.addSystem(entitySystem)

    this.sceneManager.build()

    this.engine.start()
  }

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
      engineStore.setAppLoadingStatus(false)
      engineStore.setAppLoadingAsset('')
    }

    DefaultLoadingManager.onError = (url: string): void => {
      notificationStore.openNotification({ type: 'error', message: `The error occurred while loading: ${url}` })
    }
  }
}

export { Application }
