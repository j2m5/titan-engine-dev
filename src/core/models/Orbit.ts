import { Model } from '../framework/Memoquent/Model'
import { IOrbit } from '@/core/models/types'
import { belongsTo } from '@/core/framework/Memoquent/decorators'
import { Actor } from '@/core/models/Actor'

class Orbit extends Model<IOrbit> {
  protected table: string = 'orbits'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { Orbit }
