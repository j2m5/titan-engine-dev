import { EventEmitter } from '@/core/framework/EventEmitter'
import { config } from '@/core/framework/config'
import { AstroControls } from '@/core/libs/AstroControls'
import { Object3D, Scene, Vector3 } from 'three'

export type ObservableRecord = {
  actorId: number
  name: string
  distance: number
  position: Vector3
}

/**
 * Типы тел, за которыми наблюдатель следит по `userData.type`.
 *
 * Тот же список фильтрует навигационный список объектов в UI, и это не
 * дублирование ради удобства: `CameraToObjectTransition.handle()` ищет живой
 * объект в `objects` по ID актора и проверяет его принадлежность сцене.
 * Категория, отсутствующая здесь, даёт мёртвую кнопку «лететь к» — поэтому
 * список один на обоих потребителей, и новый тип дописывается сюда однажды.
 */
export const OBSERVED_TYPES: readonly string[] = ['planet', 'star', 'blackHole', 'brownDwarf', 'whiteDwarf', 'giantStar', 'pulsar']

/**
 * Потолок дельты, которую накопитель тика впитывает за один кадр, с.
 *
 * `Engine` останавливает и перебазирует `renderClock` между сценариями, поэтому
 * меню не попадает в дельту первого кадра. Потолок также защищает от любого
 * большого доставленного шага: без него порог перепрыгивался бы, и пересчёт случался бы на ещё не
 * переставленной камере прошлого сценария: стример грузил бы чужие карты, а
 * предоплата бюджета держала бы неверный набор до истечения MIN_RESIDENCY_MS.
 * 0.1 с — заведомо плохой кадр: любой реальный проходит целиком, пауза
 * загрузки — нет.
 */
const MAX_TICK_DELTA_SECONDS: number = 0.1

class SceneObserver extends EventEmitter<{
  change: [Vector3]
  ClosestChange: [ObservableRecord | null]
}> {
  private _observable: AstroControls | null = null
  private _scene: Scene | null = null

  public data: Map<number, ObservableRecord> = new Map()
  public objects: Object3D[] = []

  private vector: Vector3 = new Vector3()
  /** Накопленное с прошлого периодического пересчёта время, мс. */
  private sinceRecompute: number = 0
  /** ID тела, отданного контролам как цель орбиты в последний раз. */
  private targetActorId: number | null = null

  private readonly onObservableChange = (event: { data: Vector3 }): void => {
    this.emit('change', event.data)
  }

  /**
   * Пока зажата ПКМ, цель орбиты не перескакивает на тело, оказавшееся
   * ближе (луна между камерой и Сатурном), но продолжает следовать за своим
   * телом — оно движется по орбите и во время драга. `ClosestChange` при этом
   * несёт честно ближайшее тело: стример и гейт карт высот живут по нему.
   */
  private readonly onChange = (): void => {
    this.defineDataRecords()

    if (!this.observable) return

    const closest: ObservableRecord | null = this.calculateClosestObject()

    if (!closest) {
      this.targetActorId = null
      this.emit('ClosestChange', null)
      return
    }

    const held: ObservableRecord | undefined =
      this.observable.isOrbiting && this.targetActorId !== null ? this.data.get(this.targetActorId) : undefined
    const target: ObservableRecord = held ?? closest

    this.targetActorId = target.actorId
    this.observable.setTarget(target.position)
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
    if (value !== this._scene) this.targetActorId = null
    this._scene = value
    this.data.clear()
    this.refreshObservableObjects()
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

  public getData(actorId: number): ObservableRecord | undefined {
    return this.data.get(actorId)
  }

  public add(record: ObservableRecord): void {
    this.data.set(record.actorId, record)
  }

  public remove(actorId: number): void {
    this.data.delete(actorId)
  }

  /**
   * Пересобирает объекты и записи расстояний прямо сейчас, не дожидаясь
   * смены `scene`. События не отправляет: гейт вызывает метод из своего
   * обработчика ClosestChange после замены поверхности.
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
    this.defineDataRecords()
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
    this.targetActorId = null
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
    if (!this._scene || !this._observable) return

    const attached = this.objects.filter((object) => {
      let root: Object3D = object
      while (root.parent) root = root.parent
      return root === this._scene
    })
    // A new snapshot also invalidates consumers such as CameraCollision.
    if (attached.length !== this.objects.length) this.objects = attached

    this.data.clear()
    this.objects.forEach((object: Object3D): void => {
      const record = this.makeRecord(object)
      if (record) this.add(record)
    })

    if (this.targetActorId !== null && !this.data.has(this.targetActorId)) this.targetActorId = null
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

  private makeRecord(object: Object3D): ObservableRecord | null {
    const actorId = object.model?.getAttribute('id')
    if (typeof actorId !== 'number' || !Number.isFinite(actorId)) return null

    return {
      actorId,
      name: object.model?.getAttribute('name', 'unknown') ?? 'unknown',
      distance: this._observable!.object.position.distanceTo(object.getWorldPosition(this.vector.clone())),
      position: object.getWorldPosition(this.vector.clone())
    }
  }
}

export { SceneObserver }
