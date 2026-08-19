import { EventEmitter } from '@/core/framework/EventEmitter'
import { config } from '@/core/framework/config'
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

/**
 * Потолок дельты, которую накопитель тика впитывает за один кадр, с.
 *
 * `renderClock` не останавливается между сценариями, поэтому дельта первого
 * кадра нового сценария вбирает всю паузу разборки и загрузки — секунды. Без
 * потолка порог перепрыгивался бы всегда, и пересчёт случался бы на ещё не
 * переставленной камере прошлого сценария: стример грузил бы чужие карты, а
 * предоплата бюджета держала бы неверный набор до истечения MIN_RESIDENCY_MS.
 * 0.1 с — заведомо плохой кадр: любой реальный проходит целиком, пауза
 * загрузки — нет.
 */
const MAX_TICK_DELTA_SECONDS: number = 0.1

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
  /** Накопленное с прошлого периодического пересчёта время, мс. */
  private sinceRecompute: number = 0

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

  /**
   * Периодический пересчёт дистанций, независимый от движения камеры.
   *
   * Зовёт тот же `onChange`, что и событие `change` от контролов — одна
   * реализация на оба повода, а не вторая копия. Событийный путь остаётся
   * мгновенным (он же обновляет цель орбиты), тик его дополняет.
   *
   * Зовётся из кадрового цикла ПОСЛЕ обновления позиций тел, поэтому видит
   * свежие дистанции. Интервал читается на каждом вызове, а не на импорте:
   * module-const заморозил бы ручку в момент загрузки модуля.
   */
  public tick(deltaSeconds: number): void {
    this.sinceRecompute += Math.min(deltaSeconds, MAX_TICK_DELTA_SECONDS) * 1000

    if (this.sinceRecompute < config('streaming.recomputeIntervalMs')) return

    this.sinceRecompute = 0
    this.onChange()
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
   * Пересобирает снимок наблюдаемых объектов (`objects`) прямо сейчас, не
   * дожидаясь смены `scene`.
   *
   * Состав наблюдения меняется не только при входе в новый сценарий:
   * `RenderableFactory.upgradePlanetToTerrain`/`downgradeTerrainToPlanet`
   * подменяют поверхность тела ПРЯМО В СЦЕНЕ (легаси `Planet` ↔ `TerrainSphere`,
   * `userData.type = 'planet'` висит на самой поверхности, не на `DynamicNode`
   * — см. `Planet.ts`/`TerrainSphere.ts`). Без пересбора старый снимок
   * `objects` продолжает держать ссылку на уже открепившийся и задиспоуженный
   * объект: `getWorldPosition` у объекта без родителя схлопывается в начало
   * координат, и дистанция до тела навсегда превращается в дистанцию до
   * центра системы — ломает ближайшее тело, приоритеты стримера, переход
   * камеры и сам гейт карт высот (см. хендофф террейна). Присваивает НОВЫЙ
   * массив (`defineObservableObjects` делает `this.objects = []`), поэтому
   * потребители, сравнивающие ссылку (`CameraCollision.refreshColliders`),
   * тоже увидят изменение.
   */
  public refreshObservableObjects(): void {
    this.defineObservableObjects()
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
    // Новый сценарий начинает отсчёт периодического пересчёта с нуля, а не с
    // хвоста, накопленного до разборки — иначе первый тик после запуска мог
    // бы выстрелить раньше настоящих 500 мс.
    this.sinceRecompute = 0
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
