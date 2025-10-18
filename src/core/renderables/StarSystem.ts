import { RenderableObject } from '@/core/renderables/RenderableObject'
import { IRenderable } from '@/core/renderables/IRenderable'
import { Object3D } from 'three'
import { Actor } from '@/core/models/Actor'

class StarSystem extends RenderableObject implements IRenderable {
  private readonly actor: Actor
  public object3D: Object3D

  public constructor(actor: Actor) {
    super()
    this.actor = actor
    this.object3D = new Object3D()
  }

  public build(): Object3D {
    this.object3D.name = this.actor.getAttribute('name')
    this.object3D.userData.type = this.actor.category.getAttribute('name')

    return this.object3D
  }

  public update(delta?: number): void {}
}

export { StarSystem }
