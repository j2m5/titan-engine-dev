import { Model } from '../framework/Memoquent/Model.ts'
import { IActor } from '@/core/models/types'
import { Category } from '@/core/models/Category.ts'
import { Orbit } from '@/core/models/Orbit.ts'
import { RotationObject } from '@/core/models/RotationObject.ts'
import { PhysicalObject } from '@/core/models/PhysicalObject.ts'
import { RenderingObject } from '@/core/models/RenderingObject.ts'
import { Placement } from '@/core/models/Placement.ts'
import { Resource } from '@/core/models/Resource.ts'
import { belongsTo, hasMany, hasOne } from '@/core/framework/Memoquent/decorators.ts'
import { Collection } from '@/core/framework/Memoquent/Collection.ts'

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
  declare public resources: Collection<Resource>

  @hasMany(() => Actor, { foreignKey: 'parentId' })
  declare public children: Collection<Actor>
}

export { Actor }
