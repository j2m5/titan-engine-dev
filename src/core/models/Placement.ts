import { Model } from '@/core/framework/Memoquent/Model.ts'
import { IPlacement } from '@/core/models/types'
import { belongsTo } from '@/core/framework/Memoquent/decorators.ts'
import { Actor } from '@/core/models/Actor.ts'

class Placement extends Model<IPlacement> {
  protected table: string = 'placements'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { Placement }
