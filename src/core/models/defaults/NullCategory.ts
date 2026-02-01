import { AllowedCategory, ICategory } from '@/core/models/types'
import { randInt } from 'three/src/math/MathUtils'

class NullCategory implements ICategory {
  public readonly id: number
  public readonly alias: AllowedCategory
  public name: string

  public constructor() {
    this.id = randInt(10000, 100000)
    this.alias = 'barycenter'
    this.name = 'Unnamed'
  }
}

export { NullCategory }
