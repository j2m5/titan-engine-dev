import { Vector3 } from 'three'

class Placeable {
  public position: Vector3

  public constructor(position: Vector3 = new Vector3()) {
    this.position = position
  }
}

export { Placeable }
