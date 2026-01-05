import { ServiceProvider } from '@/core/framework/services/ServiceProvider'
import { Engine } from '@/core/Engine'
import { Application } from '@/Application'
import { RenderManager } from '@/core/services/RenderManager'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import { TextureManager } from '@/core/services/TextureManager'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import { SceneManager } from '@/core/services/SceneManager'
import { MarkerManager } from '@/core/services/MarkerManager'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioLoader } from '@/core/services/ScenarioLoader'
import { RenderSystem } from '@/core/systems/RenderSystem'
import { EntitySystem } from '@/core/systems/EntitySystem'
import { SceneObserver } from '@/core/services/SceneObserver'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'

class AppServiceProvider extends ServiceProvider {
  public register(): void {
    this.container.bind('Engine').to(Engine).inSingletonScope()
    this.container.bind('Application').to(Application).inSingletonScope()
    this.container.bind('RenderManager').to(RenderManager).inSingletonScope()
    this.container.bind('CubeMapTextureManager').to(CubeMapTextureManager).inSingletonScope()
    this.container.bind('TextureManager').to(TextureManager).inSingletonScope()
    this.container.bind('ImageBitmapManager').to(ImageBitmapManager).inSingletonScope()
    this.container.bind('SceneManager').to(SceneManager).inSingletonScope()
    this.container.bind('MarkerManager').to(MarkerManager).inSingletonScope()
    this.container.bind('ResourceObserver').to(ResourceObserver).inSingletonScope()
    this.container.bind('ScenarioLoader').to(ScenarioLoader).inSingletonScope()
    this.container.bind('RenderSystem').to(RenderSystem).inSingletonScope()
    this.container.bind('EntitySystem').to(EntitySystem).inSingletonScope()
    this.container.bind('SceneObserver').to(SceneObserver).inSingletonScope()
    this.container.bind(CameraToObjectTransition).toSelf().inTransientScope()
  }
}

export { AppServiceProvider }
