import { injectable } from 'inversify'
import { PerspectiveCamera, Sphere } from 'three'
import { CameraParameters } from '@/config/three'
import { config } from '@/core/framework/config'

@injectable()
class CameraService {
  public camera: PerspectiveCamera
  public sphere: Sphere

  public constructor() {
    const settings: CameraParameters = config('camera')
    this.camera = new PerspectiveCamera(settings.fov, settings.aspect, settings.near, settings.far)
    this.sphere = new Sphere(this.camera.position.clone(), 0.000001)
  }
}

export { CameraService }
