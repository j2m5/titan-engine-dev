import { AllowedCategory } from '@/core/models/types'
import { System } from '@/core/framework/System'
import { AppState } from '@/core/services/states/AppState'
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

export const PrimaryActors: AllowedCategory[] = ['barycenter', 'star', 'planet', 'blackHole']

class EntitySystem extends System {
  private state: AppState

  public constructor(state: AppState) {
    super()
    this.state = state
  }

  public appliesTo(entity: Entity): boolean {
    return entity.hasComponent(Object3D)
  }

  public initialize(engine: Engine): void {
    this.state.map.forEach((actor: Actor): void => {
      const entity: Entity = new Entity()
      entity.id = actor.getAttribute('id')

      const object: IRenderable = RenderableFactory.resolveAndCreateActor(actor, this.state.uuid)

      entity.addComponents(actor, object, object.build())

      if (PrimaryActors.includes(actor.category.getAttribute('alias'))) {
        entity.addComponents(new Placeable(), new Movable())
      }

      if (this.state.uuid === 'galaxy' && actor.category.getAttribute('id') === 3) {
        entity.addComponent(new UsesMark('diamond'))
      }

      if (
        this.state.uuid === 'starSystem' &&
        (actor.category.getAttribute('id') === 7 || actor.category.getAttribute('id') === 5)
      ) {
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
