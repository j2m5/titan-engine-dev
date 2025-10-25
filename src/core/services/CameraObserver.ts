import { injectable } from 'inversify'
import { EventEmitter } from '@/core/framework/EventEmitter'
import { AstroControls } from '@/core/libs/AstroControls'
import { Object3D, Scene, Vector3 } from 'three'
import { getObjectsByUserDataProperty } from '@/core/helpers/finder'

export type DistanceRecord = {
  name: string
  distance: number
}

@injectable()
class CameraObserver extends EventEmitter {
  private _observable: AstroControls | null = null
  private _scene: Scene | null = null

  public distances: Map<string, number> = new Map()
  public objects: Object3D[] = []

  private readonly categories: string[] = ['planet', 'star']
  private vector: Vector3 = new Vector3()

  private readonly onObservableChange = (event: { data: Vector3 }): void => {
    this.emit('change', event.data)
  }

  private readonly onChange = (): void => {
    this.defineDistanceRecords()
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

  public getDistance(name: string): number | undefined {
    return this.distances.get(name)
  }

  public add({ name, distance }: DistanceRecord): void {
    this.emit('distanceChange', { name, distance })
    this.distances.set(name, distance)
  }

  public remove(name: string): void {
    this.distances.delete(name)
  }

  public dispose(): void {
    if (this._observable) {
      this._observable.removeEventListener('change', this.onObservableChange)
      this._observable = null
    }

    this.unsubscribe('change', this.onChange)

    this.objects = []
    this.distances.clear()
    this._scene = null
  }

  private defineObservableObjects(): void {
    if (!this._scene) return

    this.objects = []

    this.categories.forEach((category: string): void => {
      this.objects.push(...getObjectsByUserDataProperty(this._scene!, 'type', category))
    })
  }

  private defineDistanceRecords(): void {
    this.objects.forEach((object: Object3D): void => {
      this.add(this.computeDistanceFromCamera(object))
    })
  }

  private computeDistanceFromCamera(object: Object3D): DistanceRecord {
    return {
      name: object.userData.model,
      distance: this._observable!.object.position.distanceTo(object.getWorldPosition(this.vector))
    }
  }
}

export { CameraObserver }
