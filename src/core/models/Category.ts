import { Model } from '../framework/Memoquent/Model'
import { ICategory } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'

class Category extends Model<ICategory> {
  protected table: string = 'categories'

  public get actors(): ModelCollection<Actor> {
    return this.hasMany(Actor, { foreignKey: 'categoryId' })
  }
}

export { Category }
