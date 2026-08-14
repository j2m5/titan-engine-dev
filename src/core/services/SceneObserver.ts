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

/**
 * Типы тел, за которыми наблюдатель следит по `userData.type`.
 *
 * Тот же список фильтрует навигационный список объектов в UI, и это не
 * дублирование ради удобства: `CameraToObjectTransition.handle()` начинается
 * с `getData(name)` и молча выходит, если записи нет. Категория, показанная в
 * списке, но неизвестная здесь, даёт мёртвую кнопку «лететь к» — поэтому
 * список один на обоих потребителей, и новый тип дописывается сюда однажды.
 */
export const OBSERVED_TYPES: readonly string[] = ['planet', 'star', 'blackHole', 'brownDwarf', 'whiteDwarf']

class SceneObserver extends EventEmitter<{
  change: [Vector3]
  ClosestChange: [ObservableRecord]
  distanceChange: [SceneObserverRecord]
}> {
  private _observable: AstroControls | null = null
  private _scene: Scene | null = null

  public data: Map<string, ObservableRecord> = new Map()
  public objects: Object3D[] = []

  private vector: Vector3 = new Vector3()

  private readonly onObservableChange = (event: { data: Vector3 }): void => {
    this.emit('change', event.data)
  }

  private readonly onChange = (): void => {
    this.defineDataRecords()

    if (!this.observable) return

    const closest: ObservableRecord | null = this.calculateClosestObject()

    if (!closest) return

    this.observable.setTarget(closest.position)
    this.emit('ClosestChange', closest)
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

  /**
   * Разборка сценария, а не самого объекта: `SceneObserver` — синглтон
   * контейнера, конструируется один раз за сессию, и `Engine.initialize()`
   * при входе в новый сценарий переустанавливает только `observable` и
   * `scene` — своих сеттеров. Подписка `this.subscribe('change', this.onChange)`
   * из конструктора (строка 42) — это самоподписка синглтона на собственное
   * событие, её никто и никогда не восстанавливает повторно, поэтому здесь
   * её снимать нельзя: ровно как `resize`/`click` в `Engine`, снятые в
   * конструкторе слушатели этого метода не трогает.
   */
  public dispose(): void {
    if (this._observable) {
      this._observable.removeEventListener('change', this.onObservableChange)
      this._observable = null
    }

    this.data.clear()
    this.objects = []
    this._scene = null
  }

  private defineObservableObjects(): void {
    if (!this._scene) return

    this.objects = []

    OBSERVED_TYPES.forEach((type: string): void => {
      this.objects.push(...this._scene!.getObjectsByUserDataProperty('type', type))
    })
  }

  private defineDataRecords(): void {
    this.objects.forEach((object: Object3D): void => {
      this.add(this.makeRecord(object))
    })
  }

  /**
   * Ближайшее тело либо null, если отслеживать нечего.
   *
   * Именно null, а не исключение: reduce без начального значения на пустом
   * массиве бросает, а зовётся это каждый кадр из onChange по событию
   * контролов — сценарий, ни одно тело которого не попало в OBSERVED_TYPES,
   * падал бы непрерывно, а не единожды.
   */
  public calculateClosestObject(): ObservableRecord | null {
    const records: ObservableRecord[] = Array.from(this.data.values())

    if (!records.length) return null

    return records.reduce((closest: ObservableRecord, current: ObservableRecord): ObservableRecord => {
      return current.distance < closest.distance ? current : closest
    })
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
      name: object.model?.getAttribute('name', 'unknown') ?? 'unknown',
      data: {
        name: object.model?.getAttribute('name', 'unknown') ?? 'unknown',
        distance: this._observable!.object.position.distanceTo(object.getWorldPosition(this.vector.clone())),
        position: object.getWorldPosition(this.vector.clone())
      }
    }
  }
}

export { SceneObserver }
