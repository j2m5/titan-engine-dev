import { Material } from 'three'

class UsesMaterial<T extends Material> {
  public material: T

  public constructor(material: T) {
    this.material = material
  }
}

export { UsesMaterial }
