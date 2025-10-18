import { Model } from '@/core/framework/Memoquent/Model'
import { IPlacement } from '@/core/models/types'
import { belongsTo } from '@/core/framework/Memoquent/decorators'
import { Actor } from '@/core/models/Actor'

class Placement extends Model<IPlacement> {
  protected table: string = 'placements'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { Placement }
