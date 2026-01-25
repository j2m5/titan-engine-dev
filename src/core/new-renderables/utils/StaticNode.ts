import { Group } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'

class StaticNode extends Group implements Acceptable<IObject3DVisitor> {
  public model: Actor | null

  public constructor(model: Actor | null = null) {
    super()
    this.model = model
    this.name = this.model?.getAttribute('name')
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitComponent(this)
  }
}

export { StaticNode }
