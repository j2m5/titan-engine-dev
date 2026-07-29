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
 *
 * Параметры фабрик приходят только из `config`: раньше часть значений
 * (`scene.name`, `clock.startTime`, `astroControls.*`) была зашита в код,
 * а одноимённые ключи конфига не читал никто.
 */
class RenderingServiceProvider extends ServiceProvider {
  public register(): void {
    this.app.singleton(Tokens.Renderer, () => createRenderer(config('renderer'), config('maxPixelRatio')))
    this.app.singleton(Tokens.LabelRenderer, () => createLabelRenderer())
    this.app.singleton(Tokens.Scene, () => createScene(config('scene')))
    this.app.singleton(Tokens.Camera, () => createCamera(config('camera')))
    this.app.singleton(Tokens.AstroControls, (c: Container) =>
      createAstroControls(c.get(Tokens.Camera), c.get(Tokens.Renderer), config('astroControls'))
    )
    this.app.singleton(Tokens.Clock, () => createClock(config('clock')))
  }
}

export { RenderingServiceProvider }
