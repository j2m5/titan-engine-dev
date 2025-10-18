import { Model } from '../framework/Memoquent/Model.ts'
import { IRenderingObject } from '@/core/models/types'
import { belongsTo } from '@/core/framework/Memoquent/decorators.ts'
import { Actor } from '@/core/models/Actor.ts'

class RenderingObject extends Model<IRenderingObject> {
  protected table: string = 'renderingObjects'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { RenderingObject }
