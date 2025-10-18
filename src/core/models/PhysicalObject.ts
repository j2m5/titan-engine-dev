import { Model } from '../framework/Memoquent/Model'
import { IPhysicalObject } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { belongsTo } from '@/core/framework/Memoquent/decorators'

class PhysicalObject extends Model<IPhysicalObject> {
  protected table: string = 'physicalObjects'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor

  @belongsTo(() => PhysicalObject, { foreignKey: 'parentId' })
  declare public parent: PhysicalObject
}

export { PhysicalObject }
