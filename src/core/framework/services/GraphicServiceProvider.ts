import { ServiceProvider } from '@/core/framework/services/ServiceProvider'
import { RendererService } from '@/core/framework/services/three/RendererService'
import { SceneService } from '@/core/framework/services/three/SceneService'
import { CameraService } from '@/core/framework/services/three/CameraService'
import { ControlsService } from '@/core/framework/services/three/ControlsService'
import { ClockService } from '@/core/framework/services/three/ClockService'

class GraphicServiceProvider extends ServiceProvider {
  public register(): void {
    this.container.bind('RendererService').to(RendererService).inSingletonScope()
    this.container.bind('SceneService').to(SceneService).inSingletonScope()
    this.container.bind('CameraService').to(CameraService).inSingletonScope()
    this.container.bind('ControlsService').to(ControlsService).inSingletonScope()
    this.container.bind('ClockService').to(ClockService).inSingletonScope()
  }
}

export { GraphicServiceProvider }
