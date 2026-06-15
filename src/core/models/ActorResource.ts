import { Model } from '@/core/framework/Memoquent/Model'
import { IActorResource } from '@/core/models/types'

class ActorResource extends Model<IActorResource> {
  protected table: string = 'actorResource'
}

export { ActorResource }
