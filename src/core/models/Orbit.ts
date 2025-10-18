import { Model } from '../framework/Memoquent/Model.ts'
import { IOrbit } from '@/core/models/types'
import { belongsTo } from '@/core/framework/Memoquent/decorators.ts'
import { Actor } from '@/core/models/Actor.ts'

class Orbit extends Model<IOrbit> {
  protected table: string = 'orbits'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { Orbit }
