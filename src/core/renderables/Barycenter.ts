import { RenderableObject } from '@/core/renderables/RenderableObject'
import { IRenderable } from '@/core/renderables/IRenderable'
import { Actor } from '@/core/models/Actor'
import { Object3D } from 'three'
import { KeplerianModel } from '@/core/libs/KeplerianModel.ts'
import { timeStore } from '@/ui/mobX/TimeStore'
import { AU, SpaceScale } from '@/core/constants'

class Barycenter extends RenderableObject implements IRenderable {
  private readonly model: Actor

  private keplerianModel: KeplerianModel

  public object3D: Object3D

  public constructor(model: Actor) {
    super()
    this.model = model

    this.keplerianModel = new KeplerianModel(timeStore.epoch, this.model)

    this.object3D = new Object3D()
  }

  public build(): Object3D {
    this.object3D.name = this.model.getAttribute('name')

    return this.object3D
  }

  public update(delta?: number): void {
    const { position } = this.keplerianModel.getStateByEpoch(timeStore.epoch)
    this.object3D.position.copy(position).multiplyScalar(AU * SpaceScale)
  }
}

export { Barycenter }
