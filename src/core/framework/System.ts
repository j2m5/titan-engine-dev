import { Entity } from '@/core/framework/Entity'
import { Engine } from '@/core/Engine'

abstract class System {
  protected readonly filteredEntities: Entity[] = []

  public abstract appliesTo(entity: Entity): boolean
  public abstract initialize(engine: Engine): void
  public abstract update(dt: number, engine: Engine): void

  public addEntity(entity: Entity): void {
    if (this.filteredEntities.includes(entity)) return

    this.filteredEntities.push(entity)
  }

  public removeEntity(entity: Entity): void {
    const index: number = this.filteredEntities.indexOf(entity)

    if (index === -1) return

    this.filteredEntities.splice(index, 1)
  }
}

export { System }
