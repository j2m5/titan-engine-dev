import { Model } from '../framework/Memoquent/Model.ts'
import { IResource } from '@/core/models/types.ts'
import { belongsTo } from '@/core/framework/Memoquent/decorators.ts'
import { Actor } from '@/core/models/Actor.ts'

class Resource extends Model<IResource> {
  protected table: string = 'resources'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { Resource }
