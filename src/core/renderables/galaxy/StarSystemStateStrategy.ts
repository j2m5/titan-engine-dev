import { IGalaxyRenderStrategy } from '@/core/renderables/galaxy/IGalaxyRenderStrategy'
import { Object3D } from 'three'

class StarSystemStateStrategy implements IGalaxyRenderStrategy {
  public build(): Object3D {
    return new Object3D()
  }

  public update(delta?: number): void {}
}

export { StarSystemStateStrategy }
