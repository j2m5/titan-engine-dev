import { ServiceProvider } from '@/core/framework/container/ServiceProvider'
import { Tokens } from '@/core/providers/tokens'
import { threeJS } from '@/core/graphic/ThreeJS'

/**
 * Проводка рендер-слоя.
 *
 * ВРЕМЕННОЕ СОСТОЯНИЕ: токены указывают на поля существующего глобального
 * `threeJS`, поэтому глобал и контейнер дают один и тот же объект и
 * потребителей можно переводить группами, не ломая сборку.
 * Задача 8 заменит `instance(...)` на ленивые `singleton(() => create...)`
 * и удалит глобал.
 */
class RenderingServiceProvider extends ServiceProvider {
  public register(): void {
    this.app.instance(Tokens.Renderer, threeJS.renderer)
    this.app.instance(Tokens.LabelRenderer, threeJS.labelRenderer)
    this.app.instance(Tokens.Scene, threeJS.scene)
    this.app.instance(Tokens.Camera, threeJS.camera)
    this.app.instance(Tokens.AstroControls, threeJS.astroControls)
    this.app.instance(Tokens.Clock, threeJS.clock)
  }
}

export { RenderingServiceProvider }
