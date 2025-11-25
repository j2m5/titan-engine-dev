import { injectable } from 'inversify'
import { Scene } from 'three'
import { config } from '@/core/framework/config'

@injectable()
class SceneService {
  public scene: Scene

  public constructor() {
    this.scene = new Scene()
    this.scene.name = config('scene.name')
  }
}

export { SceneService }
