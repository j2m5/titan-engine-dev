import { Model } from '@/core/framework/Memoquent/Model'
import { IRotationObject } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'

class RotationObject extends Model<IRotationObject> {
  protected table: string = 'rotationObjects'

  public get actor(): Actor | null {
    return this.belongsTo(Actor, { foreignKey: 'actorId' })
  }
}

export { RotationObject }
