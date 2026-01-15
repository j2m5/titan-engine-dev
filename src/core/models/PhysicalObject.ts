import { Model } from '../framework/Memoquent/Model'
import { IPhysicalObject } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'

class PhysicalObject extends Model<IPhysicalObject> {
  protected table: string = 'physicalObjects'

  public get actor(): Actor | null {
    return this.belongsTo(Actor, { foreignKey: 'actorId' })
  }

  public get parent(): PhysicalObject | null {
    return this.belongsTo(PhysicalObject, { foreignKey: 'parentId' })
  }
}

export { PhysicalObject }
