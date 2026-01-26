import { IcosahedronGeometry, InstancedMesh } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'

class InstancedAsteroid extends InstancedMesh {
  public constructor(count: number) {
    super(new IcosahedronGeometry(toThreeJSUnits(5)), new InstancedAsteroidMaterial(), count)
  }
}

export { InstancedAsteroid }
