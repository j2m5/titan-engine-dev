import { Model } from '../framework/Memoquent/Model'
import { IActor } from '@/core/models/types'
import { Category } from '@/core/models/Category'
import { Orbit } from '@/core/models/Orbit'
import { RotationObject } from '@/core/models/RotationObject'
import { PhysicalObject } from '@/core/models/PhysicalObject'
import { RenderingObject } from '@/core/models/RenderingObject'
import { Placement } from '@/core/models/Placement'
import { Resource } from '@/core/models/Resource'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { ScenarioScope } from '@/core/models/scopes/ScenarioScope'
import { ActorResource } from '@/core/models/ActorResource'

class Actor extends Model<IActor> {
  protected table: string = 'actors'

  static {
    this.addGlobalScope('scenario', new ScenarioScope())
  }

  public get category(): Category | null {
    return this.belongsTo(Category, { foreignKey: 'categoryId' })
  }

  public get parent(): Actor | null {
    return this.belongsTo(Actor, { foreignKey: 'parentId' })
  }

  public get orbit(): Orbit | null {
    return this.hasOne(Orbit, { foreignKey: 'actorId' })
  }

  public get rotation(): RotationObject | null {
    return this.hasOne(RotationObject, { foreignKey: 'actorId' })
  }

  public get physicalObject(): PhysicalObject | null {
    return this.hasOne(PhysicalObject, { foreignKey: 'actorId' })
  }

  public get renderingObject(): RenderingObject | null {
    return this.hasOne(RenderingObject, { foreignKey: 'actorId' })
  }

  public get placement(): Placement | null {
    return this.hasOne(Placement, { foreignKey: 'actorId' })
  }

  public get resources(): ModelCollection<Resource> {
    return this.belongsToMany(Resource, ActorResource, { foreignKey: 'actorId', relatedKey: 'resourceId' })
  }

  public get children(): ModelCollection<Actor> {
    return this.hasMany(Actor, { foreignKey: 'parentId' })
  }
}

export { Actor }
