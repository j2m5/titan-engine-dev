import { Model } from '@/core/framework/Memoquent/Model.ts'
import { IRotationObject } from '@/core/models/types.ts'
import { belongsTo } from '@/core/framework/Memoquent/decorators.ts'
import { Actor } from '@/core/models/Actor.ts'

class RotationObject extends Model<IRotationObject> {
  protected table: string = 'rotationObjects'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { RotationObject }
