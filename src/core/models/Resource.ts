import { Model } from '../framework/Memoquent/Model'
import { IResource } from '@/core/models/types'
import { belongsTo } from '@/core/framework/Memoquent/decorators'
import { Actor } from '@/core/models/Actor'

class Resource extends Model<IResource> {
  protected table: string = 'resources'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { Resource }
