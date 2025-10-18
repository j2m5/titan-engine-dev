import { Model } from '../framework/Memoquent/Model.ts'
import { ICategory } from '@/core/models/types'
import { Actor } from '@/core/models/Actor.ts'
import { hasMany } from '@/core/framework/Memoquent/decorators.ts'

class Category extends Model<ICategory> {
  protected table: string = 'categories'

  @hasMany(() => Actor, { foreignKey: 'categoryId' })
  declare public actors: Actor[]
}

export { Category }
