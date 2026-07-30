import { ServiceProvider } from '@/core/framework/container/ServiceProvider'
import { Container } from '@/core/framework/container/Container'
import { Tokens } from '@/core/providers/tokens'
import { Engine } from '@/core/Engine'
import { Application } from '@/Application'
import { TextureProvider } from '@/core/textures/TextureProvider'
import { SceneManager } from '@/core/services/SceneManager'
import { MarkerManager } from '@/core/services/MarkerManager'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { SceneObserver } from '@/core/services/SceneObserver'
import { SimulationClock } from '@/core/time/SimulationClock'
import { CameraController } from '@/core/camera/CameraController'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { LeakDetector } from '@/core/lifecycle/LeakDetector'
import { TextureBudget } from '@/core/streaming/TextureBudget'

class AppServiceProvider extends ServiceProvider {
  public register(): void {
    this.app.singleton(Tokens.SimulationClock, () => new SimulationClock())
    this.app.singleton(Tokens.CameraController, () => new CameraController())

    this.app.singleton(Tokens.SceneObserver, () => new SceneObserver())

    this.app.singleton(Tokens.TextureProvider, (c: Container) => new TextureProvider(c.get(Tokens.Renderer)))

    this.app.singleton(
      Tokens.MarkerManager,
      (c: Container) => new MarkerManager(c.get(Tokens.SceneObserver), c.get(Tokens.Settings))
    )

    this.app.singleton(
      Tokens.RenderableFactory,
      (c: Container) => new RenderableFactory(c.get(Tokens.Renderer), c.get(Tokens.Scene))
    )

    this.app.singleton(
      Tokens.SceneManager,
      (c: Container) =>
        new SceneManager(
          c.get(Tokens.MarkerManager),
          c.get(Tokens.Settings),
          c.get(Tokens.Scene),
          c.get(Tokens.RenderableFactory)
        )
    )

    this.app.singleton(
      Tokens.Postprocessing,
      (c: Container) => new Postprocessing(c.get(Tokens.Renderer), c.get(Tokens.Scene), c.get(Tokens.Camera))
    )

    this.app.singleton(
      Tokens.Engine,
      (c: Container) =>
        new Engine(
          c.get(Tokens.SceneManager),
          c.get(Tokens.SceneObserver),
          c.get(Tokens.SimulationClock),
          c.get(Tokens.CameraController),
          c.get(Tokens.Renderer),
          c.get(Tokens.LabelRenderer),
          c.get(Tokens.Scene),
          c.get(Tokens.Camera),
          c.get(Tokens.AstroControls),
          c.get(Tokens.Clock),
          c.get(Tokens.Postprocessing)
        )
    )

    // Бюджет самоназначенный: WebGL не умеет спрашивать, сколько видеопамяти
    // занято. Величину задаёт худшая реальная пара сцены — Земля с пятью
    // картами 8K (853 МиБ) и Луна с двумя (341 МиБ), вместе 1194 МиБ. При
    // гигабайте Земля забирала почти весь бюджет и Луна рядом с ней теряла
    // текстуру; полтора гигабайта вмещают пару с запасом в 342 МиБ.
    // Порог осознанно выше «нижнего грейда» видеопамяти: у вкладки есть ещё
    // таргеты постобработки и LUT атмосферы, так что на картах с 4 ГБ это
    // ближе к пределу, чем к комфорту.
    this.app.singleton(Tokens.TextureBudget, () => new TextureBudget(1536 * 1024 ** 2))

    this.app.singleton(
      Tokens.ResourceObserver,
      (c: Container) =>
        new ResourceObserver(
          c.get(Tokens.SceneObserver),
          c.get(Tokens.TextureProvider),
          c.get(Tokens.LoadingProgressReporter),
          c.get(Tokens.NotificationSink),
          c.get(Tokens.Scene),
          c.get(Tokens.TextureBudget)
        )
    )

    this.app.singleton(Tokens.LeakDetector, (c: Container) => new LeakDetector(c.get(Tokens.Renderer)))

    this.app.singleton(
      Tokens.Application,
      (c: Container) =>
        new Application(
          c.get(Tokens.Engine),
          c.get(Tokens.ResourceObserver),
          c.get(Tokens.Scene),
          c.get(Tokens.LeakDetector)
        )
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
          c.get(Tokens.MenuController),
          c.get(Tokens.Camera),
          c.get(Tokens.AstroControls),
          c.get(Tokens.Clock)
        )
    )
  }
}

export { AppServiceProvider }
