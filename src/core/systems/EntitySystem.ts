import { AllowedCategory } from '@/core/models/types'
import { System } from '@/core/framework/System'
import { Entity } from '@/core/framework/Entity'
import { Engine } from '@/core/Engine'
import { Object3D } from 'three'
import { Actor } from '@/core/models/Actor'
import { IRenderable } from '@/core/renderables/IRenderable'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { UsesMark } from '@/core/framework/components/UsesMark'
import { RenderableObject } from '@/core/renderables/RenderableObject'
import { Placeable } from '@/core/framework/components/Placeable'
import { Movable } from '@/core/framework/components/Movable'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { inject, injectable } from 'inversify'

export const PrimaryActors: AllowedCategory[] = ['barycenter', 'star', 'planet', 'blackHole']

@injectable()
class EntitySystem extends System {
  public constructor(@inject('ResourceObserver') private resourceObserver: ResourceObserver) {
    super()
  }

  public appliesTo(entity: Entity): boolean {
    return entity.hasComponent(Object3D)
  }

  public initialize(engine: Engine): void {
    this.resourceObserver.map.forEach((actor: Actor): void => {
      const entity: Entity = new Entity()
      entity.id = actor.getAttribute('id')

      const object: IRenderable = RenderableFactory.resolveAndCreateActor(actor)

      entity.addComponents(actor, object, object.build())

      if (PrimaryActors.includes(actor.category.getAttribute('alias'))) {
        entity.addComponents(new Placeable(), new Movable())
      }

      if (actor.category.getAttribute('id') === 7 || actor.category.getAttribute('id') === 5) {
        entity.addComponent(new UsesMark('circle'))
      }

      engine.addEntity(entity)
    })
  }

  public update(dt: number, engine: Engine): void {
    engine.entities.forEach((entity: Entity): void => {
      if (entity.hasComponent(RenderableObject)) {
        entity.getComponent(RenderableObject).update(dt)
      }
    })
  }
}

export { EntitySystem }
