import { Model } from '../framework/Memoquent/Model'
import { IResource } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'

class Resource extends Model<IResource> {
  protected table: string = 'resources'

  public get actor(): Actor | null {
    return this.belongsTo(Actor, { foreignKey: 'actorId' })
  }
}

export { Resource }
