import { Model } from '../framework/Memoquent/Model'
import { IActor } from '@/core/models/types'
import { Category } from '@/core/models/Category'
import { Orbit } from '@/core/models/Orbit'
import { RotationObject } from '@/core/models/RotationObject'
import { PhysicalObject } from '@/core/models/PhysicalObject'
import { RenderingObject } from '@/core/models/RenderingObject'
import { Placement } from '@/core/models/Placement'
import { Resource } from '@/core/models/Resource'
import { belongsTo, hasMany, hasOne } from '@/core/framework/Memoquent/decorators'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'

class Actor extends Model<IActor> {
  protected table: string = 'actors'

  @belongsTo(() => Category, { foreignKey: 'categoryId' })
  declare public category: Category

  @belongsTo(() => Actor, { foreignKey: 'parentId' })
  declare public parent: Actor

  @hasOne(() => Orbit, { foreignKey: 'actorId' })
  declare public orbit: Orbit

  @hasOne(() => RotationObject, { foreignKey: 'actorId' })
  declare public rotation: RotationObject

  @hasOne(() => PhysicalObject, { foreignKey: 'actorId' })
  declare public physicalObject: PhysicalObject

  @hasOne(() => RenderingObject, { foreignKey: 'actorId' })
  declare public renderingObject: RenderingObject

  @hasOne(() => Placement, { foreignKey: 'actorId' })
  declare public placement: Placement

  @hasMany(() => Resource, { foreignKey: 'actorId' })
  declare public resources: ModelCollection<Resource>

  @hasMany(() => Actor, { foreignKey: 'parentId' })
  declare public children: ModelCollection<Actor>
}

export { Actor }
