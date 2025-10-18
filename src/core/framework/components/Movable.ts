import { Vector3 } from 'three'

class Movable {
  public velocity: Vector3

  public constructor(velocity: Vector3 = new Vector3()) {
    this.velocity = velocity
  }
}

export { Movable }
