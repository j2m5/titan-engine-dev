import { Group } from 'three'
import { Actor } from '@/core/models/Actor'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { AU, SpaceScale } from '@/core/constants'
import { timeStore } from '@/ui/mobx/TimeStore'

class DynamicNode extends Group {
  public model: Actor

  private keplerianModel: KeplerianModel

  public constructor(model: Actor) {
    super()
    this.model = model
    this.keplerianModel = new KeplerianModel(timeStore.epoch, this.model)
  }

  public updateObject(delta?: number): void {
    const { position } = this.keplerianModel.getStateByEpoch(timeStore.epoch)
    this.position.copy(position).multiplyScalar(AU * SpaceScale)
  }
}

export { DynamicNode }
