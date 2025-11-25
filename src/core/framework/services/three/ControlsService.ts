import { inject, injectable } from 'inversify'
import { AstroControls } from '@/core/libs/AstroControls'
import { CameraService } from '@/core/framework/services/three/CameraService'
import { RendererService } from '@/core/framework/services/three/RendererService'
import { config } from '@/core/framework/config'

@injectable()
class ControlsService {
  public astroControls: AstroControls

  public constructor(
    @inject('CameraService') cameraService: CameraService,
    @inject('RendererSerice') rendererService: RendererService
  ) {
    const { camera, sphere } = cameraService
    const { renderer } = rendererService

    this.astroControls = new AstroControls(camera, sphere, renderer.domElement)
    this.astroControls.rollSpeed = config('astroControls.rollSpeed')
    this.astroControls.autoForward = config('astroControls.autoForward')
  }
}

export { ControlsService }
