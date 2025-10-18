import { Model } from '../framework/Memoquent/Model'
import { IRenderingObject } from '@/core/models/types'
import { belongsTo } from '@/core/framework/Memoquent/decorators'
import { Actor } from '@/core/models/Actor'

class RenderingObject extends Model<IRenderingObject> {
  protected table: string = 'renderingObjects'

  @belongsTo(() => Actor, { foreignKey: 'actorId' })
  declare public actor: Actor
}

export { RenderingObject }
