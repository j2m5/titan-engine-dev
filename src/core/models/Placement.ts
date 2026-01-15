import { Model } from '@/core/framework/Memoquent/Model'
import { IPlacement } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'

class Placement extends Model<IPlacement> {
  protected table: string = 'placements'

  public get actor(): Actor | null {
    return this.belongsTo(Actor, { foreignKey: 'actorId' })
  }
}

export { Placement }
