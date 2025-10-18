import { RenderableObject } from '@/core/renderables/RenderableObject'
import { IRenderable } from '@/core/renderables/IRenderable'
import { Actor } from '@/core/models/Actor'
import { IGalaxyRenderStrategy } from '@/core/renderables/galaxy/IGalaxyRenderStrategy'
import { Object3D } from 'three'

class Galaxy extends RenderableObject implements IRenderable {
  private readonly model: Actor
  private readonly strategy: IGalaxyRenderStrategy
  public object3D: Object3D

  public constructor(model: Actor, strategy: IGalaxyRenderStrategy) {
    super()
    this.model = model
    this.strategy = strategy
    this.object3D = this.strategy.build()
  }

  public build(): Object3D {
    this.object3D.name = this.model.getAttribute('name')
    this.object3D.userData.type = this.model.category.getAttribute('name')
    this.object3D.rotateX(Math.PI / 2)

    return this.object3D
  }

  public update(delta?: number): void {
    this.strategy.update(delta)
  }
}

export { Galaxy }
