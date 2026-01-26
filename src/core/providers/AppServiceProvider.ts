import { ServiceProvider } from '@/core/framework/services/ServiceProvider'
import { Engine } from '@/core/Engine'
import { Application } from '@/Application'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import { TextureManager } from '@/core/services/TextureManager'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import { SceneManager } from '@/core/services/SceneManager'
import { MarkerManager } from '@/core/services/MarkerManager'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { SceneObserver } from '@/core/services/SceneObserver'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'

class AppServiceProvider extends ServiceProvider {
  public register(): void {
    this.container.bind('Engine').to(Engine).inSingletonScope()
    this.container.bind('Application').to(Application).inSingletonScope()
    this.container.bind('CubeMapTextureManager').to(CubeMapTextureManager).inSingletonScope()
    this.container.bind('TextureManager').to(TextureManager).inSingletonScope()
    this.container.bind('ImageBitmapManager').to(ImageBitmapManager).inSingletonScope()
    this.container.bind('SceneManager').to(SceneManager).inSingletonScope()
    this.container.bind('MarkerManager').to(MarkerManager).inSingletonScope()
    this.container.bind('ResourceObserver').to(ResourceObserver).inSingletonScope()
    this.container.bind('SceneObserver').to(SceneObserver).inSingletonScope()
    this.container.bind(CameraToObjectTransition).toSelf().inTransientScope()
  }
}

export { AppServiceProvider }
