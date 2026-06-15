import { Model } from '../framework/Memoquent/Model'
import { IResource } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { ActorResource } from '@/core/models/ActorResource'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'

class Resource extends Model<IResource> {
  protected table: string = 'resources'

  public get actors(): ModelCollection<Actor> {
    return this.belongsToMany(Actor, ActorResource, { foreignKey: 'resourceId', relatedKey: 'actorId' })
  }
}

export { Resource }
