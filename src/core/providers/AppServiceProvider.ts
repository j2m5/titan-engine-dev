import { ServiceProvider } from '@/core/framework/container/ServiceProvider'
import { Container } from '@/core/framework/container/Container'
import { Tokens } from '@/core/providers/tokens'
import { Engine } from '@/core/Engine'
import { Application } from '@/Application'
import { CubeMapTextureManager } from '@/core/services/CubeMapTextureManager'
import { TextureManager } from '@/core/services/TextureManager'
import { ImageBitmapManager } from '@/core/services/ImageBitmapManager'
import { SceneManager } from '@/core/services/SceneManager'
import { MarkerManager } from '@/core/services/MarkerManager'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { SceneObserver } from '@/core/services/SceneObserver'
import { SimulationClock } from '@/core/time/SimulationClock'
import { CameraController } from '@/core/camera/CameraController'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'

class AppServiceProvider extends ServiceProvider {
  public register(): void {
    this.app.singleton(Tokens.SimulationClock, () => new SimulationClock())
    this.app.singleton(Tokens.CameraController, () => new CameraController())

    this.app.singleton(Tokens.SceneObserver, () => new SceneObserver())

    this.app.singleton(Tokens.CubeMapTextureManager, () => new CubeMapTextureManager())
    this.app.singleton(Tokens.TextureManager, () => new TextureManager())
    this.app.singleton(Tokens.ImageBitmapManager, () => new ImageBitmapManager())

    this.app.singleton(
      Tokens.MarkerManager,
      (c: Container) => new MarkerManager(c.get(Tokens.SceneObserver), c.get(Tokens.Settings))
    )

    this.app.singleton(
      Tokens.SceneManager,
      (c: Container) => new SceneManager(c.get(Tokens.MarkerManager), c.get(Tokens.Settings))
    )

    this.app.singleton(
      Tokens.Engine,
      (c: Container) =>
        new Engine(
          c.get(Tokens.SceneManager),
          c.get(Tokens.SceneObserver),
          c.get(Tokens.SimulationClock),
          c.get(Tokens.CameraController)
        )
    )

    this.app.singleton(
      Tokens.ResourceObserver,
      (c: Container) =>
        new ResourceObserver(
          c.get(Tokens.SceneObserver),
          c.get(Tokens.CubeMapTextureManager),
          c.get(Tokens.TextureManager),
          c.get(Tokens.ImageBitmapManager),
          c.get(Tokens.LoadingProgressReporter),
          c.get(Tokens.NotificationSink)
        )
    )

    this.app.singleton(
      Tokens.Application,
      (c: Container) => new Application(c.get(Tokens.Engine), c.get(Tokens.ResourceObserver))
    )

    // Команды — transient с конструктором класса в роли ключа:
    // каждый Command.execute() получает свежий экземпляр.
    this.app.bind(
      CameraToObjectTransition,
      (c: Container) =>
        new CameraToObjectTransition(
          c.get(Tokens.SceneObserver),
          c.get(Tokens.CameraController),
          c.get(Tokens.NotificationSink),
          c.get(Tokens.MenuController)
        )
    )
  }
}

export { AppServiceProvider }
