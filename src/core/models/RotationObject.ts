import { Model } from '@/core/framework/Memoquent/Model'
import { IRotationObject } from '@/core/models/types'
import { belongsTo } from '@/core/framework/Memoquent/decorators'
import { Actor } from '@/core/models/Actor'

class RotationObject extends Model<IRotationObject> {
  protected table: string = 'rotationObjects'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { RotationObject }
