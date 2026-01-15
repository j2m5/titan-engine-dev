import { Model } from '../framework/Memoquent/Model'
import { IRenderingObject } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'

class RenderingObject extends Model<IRenderingObject> {
  protected table: string = 'renderingObjects'

  public get actor(): Actor | null {
    return this.belongsTo(Actor, { foreignKey: 'actorId' })
  }
}

export { RenderingObject }
