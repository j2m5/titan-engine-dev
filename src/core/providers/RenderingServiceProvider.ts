import { ServiceProvider } from '@/core/framework/container/ServiceProvider'
import { Container } from '@/core/framework/container/Container'
import { Tokens } from '@/core/providers/tokens'
import { config } from '@/core/framework/config'
import {
  createAstroControls,
  createCamera,
  createClock,
  createLabelRenderer,
  createRenderer,
  createScene
} from '@/core/graphic/renderingFactories'

/**
 * Проводка рендер-слоя.
 *
 * Все привязки ленивые: объекты Three создаются при первом резолве, а не на
 * импорте модуля. Поэтому bootstrap() безопасен там, где WebGL нет вовсе
 * (jsdom), а тесты могут перекрыть любой из токенов заглушкой до того,
 * как настоящая фабрика будет вызвана.
 */
class RenderingServiceProvider extends ServiceProvider {
  public register(): void {
    this.app.singleton(Tokens.Renderer, () => createRenderer(config('renderer')))
    this.app.singleton(Tokens.LabelRenderer, () => createLabelRenderer())
    this.app.singleton(Tokens.Scene, () => createScene())
    this.app.singleton(Tokens.Camera, () => createCamera(config('camera')))
    this.app.singleton(Tokens.AstroControls, (c: Container) =>
      createAstroControls(c.get(Tokens.Camera), c.get(Tokens.Renderer))
    )
    this.app.singleton(Tokens.Clock, () => createClock())
  }
}

export { RenderingServiceProvider }
