import { DynamicNode } from '@/core/new-renderables/utils/DynamicNode'
import { Actor } from '@/core/models/Actor'

class Barycenter extends DynamicNode {
  public model: Actor

  public constructor(model: Actor) {
    super(model)
    this.model = model
    this.name = this.model.getAttribute('name')
  }
}

export { Barycenter }
