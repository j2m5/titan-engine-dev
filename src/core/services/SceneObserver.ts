import { injectable } from 'inversify'
import { EventEmitter } from '@/core/framework/EventEmitter'
import { AstroControls } from '@/core/libs/AstroControls'
import { Object3D, Scene, Vector3 } from 'three'

export type ObservableRecord = {
  name: string
  distance: number
  position: Vector3
}

export type SceneObserverRecord = {
  name: string
  data: ObservableRecord
}

@injectable()
class SceneObserver extends EventEmitter {
  private _observable: AstroControls | null = null
  private _scene: Scene | null = null

  public data: Map<string, ObservableRecord> = new Map()
  public objects: Object3D[] = []

  private readonly categories: string[] = ['planet', 'star']
  private vector: Vector3 = new Vector3()

  private readonly onObservableChange = (event: { data: Vector3 }): void => {
    this.emit('change', event.data)
  }

  private readonly onChange = (): void => {
    this.defineDataRecords()

    if (this.observable) {
      const closest = this.calculateClosestObject()
      this.observable.setTarget(closest.position)
      this.emit('ClosestChange', closest)
    }
  }

  public constructor() {
    super()
    this.subscribe('change', this.onChange)
  }

  public get observable(): AstroControls | null {
    return this._observable
  }

  public set observable(value: AstroControls) {
    if (this._observable) {
      this._observable.removeEventListener('change', this.onObservableChange)
    }

    this._observable = value

    this._observable.addEventListener('change', this.onObservableChange)
  }

  public get scene(): Scene | null {
    return this._scene
  }

  public set scene(value: Scene) {
    this._scene = value

    this.defineObservableObjects()
  }

  public get cameraPosition(): Vector3 {
    if (!this._observable) return new Vector3()

    return this._observable.object.position.clone()
  }

  public getData(name: string): ObservableRecord | undefined {
    return this.data.get(name)
  }

  public add({ name, data }: SceneObserverRecord): void {
    this.emit('distanceChange', { name, data })
    this.data.set(name, data)
  }

  public remove(name: string): void {
    this.data.delete(name)
  }

  public dispose(): void {
    if (this._observable) {
      this._observable.removeEventListener('change', this.onObservableChange)
      this._observable = null
    }

    this.unsubscribe('change', this.onChange)

    this.data.clear()
    this.objects = []
    this._scene = null
  }

  private defineObservableObjects(): void {
    if (!this._scene) return

    this.objects = []

    this.categories.forEach((category: string): void => {
      this.objects.push(...this._scene!.getObjectsByUserDataProperty('type', category))
    })
  }

  private defineDataRecords(): void {
    this.objects.forEach((object: Object3D): void => {
      this.add(this.makeRecord(object))
    })
  }

  public calculateClosestObject(): ObservableRecord {
    return Array.from(this.data.values()).reduce(
      (closest: ObservableRecord, current: ObservableRecord): ObservableRecord => {
        return current.distance < closest.distance ? current : closest
      }
    )
  }

  public calculateFarthestObjects(count: number = 1, filtered?: ObservableRecord[]): ObservableRecord[] {
    const data = filtered && filtered.length ? filtered : Array.from(this.data.values())
    const result: ObservableRecord[] = []

    for (const record of data) {
      result.push(record)

      result.sort((a, b) => b.distance - a.distance)

      if (result.length > count) {
        result.pop()
      }
    }

    return result
  }

  private makeRecord(object: Object3D): SceneObserverRecord {
    return {
      name: object.model?.getAttribute('name', 'unknown'),
      data: {
        name: object.model?.getAttribute('name', 'unknown'),
        distance: this._observable!.object.position.distanceTo(object.getWorldPosition(this.vector.clone())),
        position: object.getWorldPosition(this.vector.clone())
      }
    }
  }
}

export { SceneObserver }
