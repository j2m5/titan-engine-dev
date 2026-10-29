import { IActor } from '@/core/models/types'
import { randInt } from 'three/src/math/MathUtils'

class NullActor implements IActor {
  public readonly id: number
  public readonly categoryId: number
  public readonly parentId: number | null
  public name: string
  public description: string
  public color: string

  public constructor(categoryId: number, parentId: number) {
    this.id = randInt(10000, 100000)
    this.categoryId = categoryId
    this.parentId = parentId
    this.name = 'Default'
    this.description = ''
    this.color = '#ffffff'
  }
}

export { NullActor }
