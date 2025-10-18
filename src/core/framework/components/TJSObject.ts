import { Object3D } from 'three'

class TJSObject<T extends Object3D = Object3D> {
  public object3D: T

  public constructor(object3D: T) {
    this.object3D = object3D
  }
}

export { TJSObject }
