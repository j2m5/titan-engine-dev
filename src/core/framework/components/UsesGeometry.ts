import { BufferGeometry } from 'three'

class UsesGeometry {
  public geometry: BufferGeometry

  public constructor(geometry: BufferGeometry) {
    this.geometry = geometry
  }
}

export { UsesGeometry }
