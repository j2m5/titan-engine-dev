import { Model } from '../framework/Memoquent/Model'
import { ICategory } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { hasMany } from '@/core/framework/Memoquent/decorators'

class Category extends Model<ICategory> {
  protected table: string = 'categories'

  @hasMany(() => Actor, { foreignKey: 'categoryId' })
  declare public actors: Actor[]
}

export { Category }
