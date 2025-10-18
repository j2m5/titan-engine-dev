import { Application } from '@/Application'
import { Scene } from 'three'
import { Actor } from '@/core/models/Actor.ts'
import { AppStates } from '@/core/models/types.ts'

abstract class AppState {
  protected entityId: number | null = null
  protected context!: Application

  public abstract readonly uuid: AppStates
  public abstract readonly scene: Scene
  public abstract readonly map: Map<number, Actor>

  public setEntityId(entityId: number | null): void {
    this.entityId = entityId
  }

  public setContext(context: Application): void {
    this.context = context
  }

  protected abstract build(): void
  public abstract load(): Promise<void>

  public clear(): void {
    this.scene.clear()
    this.map.clear()
    this.context.markerManager.clear()
  }
}

export { AppState }
