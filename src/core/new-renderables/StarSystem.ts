import { Object3D } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'

class StarSystem extends Object3D implements Acceptable<IObject3DVisitor> {
  public model: Actor

  public constructor(model: Actor) {
    super()
    this.model = model
    this.name = this.model.getAttribute('name')
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitRoot(this)
  }
}

export { StarSystem }
