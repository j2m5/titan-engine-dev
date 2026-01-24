import { Object3D } from 'three'
import { Actor } from '@/core/models/Actor'

class StarSystem extends Object3D {
  public model: Actor

  public constructor(model: Actor) {
    super()
    this.model = model
    this.name = this.model.getAttribute('name')
  }
}

export { StarSystem }
