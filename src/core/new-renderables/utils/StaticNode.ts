import { Group } from 'three'
import { Actor } from '@/core/models/Actor'

class StaticNode extends Group {
  public model: Actor | null

  public constructor(model: Actor | null = null) {
    super()
    this.model = model
  }
}

export { StaticNode }
