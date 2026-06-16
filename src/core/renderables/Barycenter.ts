import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { Actor } from '@/core/models/Actor'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'

class Barycenter extends DynamicNode {
  public model: Actor

  public constructor(model: Actor) {
    super(model)
    this.model = model
    this.name = this.model.getAttribute('name')
  }

  public override accept(visitor: IObject3DVisitor): void {
    if (!this.model.parent) {
      visitor.visitRoot(this)
    } else {
      visitor.visitNode(this)
    }
  }
}

export { Barycenter }
