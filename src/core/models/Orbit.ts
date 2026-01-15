import { Model } from '../framework/Memoquent/Model'
import { IOrbit } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'

class Orbit extends Model<IOrbit> {
  protected table: string = 'orbits'

  public get actor(): Actor | null {
    return this.belongsTo(Actor, { foreignKey: 'actorId' })
  }
}

export { Orbit }
