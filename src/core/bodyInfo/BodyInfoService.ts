import { Vector3, type Object3D, type PerspectiveCamera, type Scene } from 'three'
import type { Actor } from '@/core/models/Actor'
import type { SimulationClock } from '@/core/time/SimulationClock'
import { resolveLightSource } from '@/core/helpers/lightSource'
import { fromKilometers } from '@/core/helpers/scaling'
import { primaryOf } from '@/core/bodyInfo/primaryOf'
import { relativeSpeedKms } from '@/core/bodyInfo/worldVelocity'
import type { BodyLive } from '@/core/bodyInfo/types'

function idOf(actor: Actor): number | undefined {
  return actor.getAttribute('id')
}

/** id актора, которого несёт узел сцены (DynamicNode, StaticNode); у прочих объектов model нет */
function modelIdOf(object: Object3D): number | undefined {
  const model: unknown = (object as { model?: unknown }).model

  return model && typeof (model as Actor).getAttribute === 'function' ? (model as Actor).getAttribute('id') : undefined
}

/** Обход в прямом порядке: узел находится раньше своего renderable, у которого тот же model */
function findByModelId(root: Object3D, id: number): Object3D | null {
  if (modelIdOf(root) === id) return root

  for (const child of root.children) {
    const found: Object3D | null = findByModelId(child, id)

    if (found) return found
  }

  return null
}

function isInScene(object: Object3D, scene: Scene): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node === scene) return true
  }

  return false
}

/**
 * Живые величины карточки объекта: расстояние от камеры до поверхности, до
 * светила и скорость относительно главного тела. Позиции — мировые матрицы
 * узлов, то есть то, что нарисовано. Сервис ничего не делает сам: его
 * опрашивает стор карточки, пока та открыта.
 */
class BodyInfoService {
  private readonly nodes: Map<number, Object3D> = new Map()
  private readonly bodyPosition: Vector3 = new Vector3()
  private readonly otherPosition: Vector3 = new Vector3()

  public constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly clock: SimulationClock
  ) {}

  public measure(actor: Actor): BodyLive | null {
    const node: Object3D | null = this.nodeOf(actor)

    if (!node) return null

    node.getWorldPosition(this.bodyPosition)
    this.camera.getWorldPosition(this.otherPosition)

    const radiusKm: number = actor.physicalObject?.getAttribute('radius', 0) ?? 0
    const centerKm: number = fromKilometers(this.bodyPosition.distanceTo(this.otherPosition))

    return {
      distanceKm: Math.max(0, centerKm - radiusKm),
      starDistanceKm: this.starDistanceKm(actor),
      orbitalSpeedKms: this.orbitalSpeedKms(actor)
    }
  }

  /** От центра тела до светила системы; у самого светила и без светила — нет */
  private starDistanceKm(actor: Actor): number | null {
    const star: Actor | undefined = resolveLightSource(actor)

    if (!star || idOf(star) === idOf(actor)) return null

    const node: Object3D | null = this.nodeOf(star)

    if (!node) return null

    node.getWorldPosition(this.otherPosition)

    return fromKilometers(this.bodyPosition.distanceTo(this.otherPosition))
  }

  private orbitalSpeedKms(actor: Actor): number | null {
    const primary: Actor | null = primaryOf(actor)

    return primary ? relativeSpeedKms(actor, primary, this.clock.epoch) : null
  }

  /**
   * Разборка сценария: отпустить запомненные узлы. disposeSceneTree отцепляет
   * только корень поддерева, связи parent/children внутри остаются — один
   * узел в кэше держал бы весь граф прошлого сценария (геометрии, пулы).
   */
  public clear(): void {
    this.nodes.clear()
  }

  /** Кэш узлов сверяется с графом: после смены сценария прежний узел отцеплен */
  private nodeOf(actor: Actor): Object3D | null {
    const id: number | undefined = idOf(actor)

    if (id === undefined) return null

    const cached: Object3D | undefined = this.nodes.get(id)

    if (cached && isInScene(cached, this.scene)) return cached

    this.nodes.delete(id)

    const found: Object3D | null = findByModelId(this.scene, id)

    if (found) this.nodes.set(id, found)

    return found
  }
}

export { BodyInfoService }
