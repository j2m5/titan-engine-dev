import { Command } from '@/core/framework/commands/Command'
import { Actor } from '@/core/models/Actor'
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { SceneObserver } from '@/core/services/SceneObserver'
import { BlackHoleParameters } from '@/core/renderables/BlackHole'
import { fromKilometers, toThreeJSUnits } from '@/core/helpers/scaling'
import anime from 'animejs'
import { CameraController } from '@/core/camera/CameraController'
import { NotificationSink } from '@/core/ports/NotificationSink'
import { MenuController } from '@/core/ports/MenuController'
import { AstroControls } from '@/core/libs/AstroControls'

/** Форма аргументов execute(); не связана с типами Command — экспорт только чтобы не считаться мёртвым кодом. */
export interface CameraToObjectTransitionArgs {
  model: Actor
}

/** Камера «уже у объекта»: расстояние до точки прилёта в пределах этой доли */
const ARRIVAL_DISTANCE_TOLERANCE: number = 0.01
/** …и взгляд на объект не дальше 1° */
const ARRIVAL_AIM_COS: number = Math.cos((1 * Math.PI) / 180)

export type FlightDecision = 'start' | 'ignore' | 'redirect' | 'arrived'

/**
 * Что делать с кликом «лететь»: повтор по тому же объекту в полёте —
 * игнорировать, по другому — развернуть полёт, если камера уже в точке прилёта
 * и смотрит на объект — не лететь вовсе. aimCos — косинус угла между взглядом
 * камеры и направлением на объект.
 */
export function decideFlight(
  activeTarget: number | null,
  target: number,
  distance: number,
  arrivalDistance: number,
  aimCos: number
): FlightDecision {
  if (activeTarget !== null) return activeTarget === target ? 'ignore' : 'redirect'

  const atArrival: boolean = Math.abs(distance - arrivalDistance) <= arrivalDistance * ARRIVAL_DISTANCE_TOLERANCE

  return atArrival && aimCos >= ARRIVAL_AIM_COS ? 'arrived' : 'start'
}

/** Идущий полёт: команды transient, поэтому он живёт в статике класса */
interface ActiveFlight {
  target: number
  timeline: anime.AnimeTimelineInstance
  /** Скорость камеры до ПЕРВОГО клика цепочки: анимация её разгоняет */
  speedBefore: number
  /** Вернуть управление и скорость — для отмены полёта при разборке сценария */
  restore: () => void
}

class CameraToObjectTransition extends Command {
  declare public model: Actor

  private static active: ActiveFlight | null = null

  /**
   * Отмена идущего полёта (разборка сценария, выход в меню): таймлайн на
   * паузе, управление и скорость возвращены. Без неё anime ещё несколько
   * секунд писал позицию камеры — уже телепортированной в новый сценарий — и
   * тащил её к цели старого. Запоздалый complete отменённого полёта ничего
   * не трогает: active уже не он.
   */
  public static cancelActive(): void {
    const active: ActiveFlight | null = CameraToObjectTransition.active

    if (!active) return

    CameraToObjectTransition.active = null
    active.timeline.pause()
    active.restore()
  }

  public constructor(
    private sceneObserver: SceneObserver,
    private camera: CameraController,
    private notifications: NotificationSink,
    private menu: MenuController,
    private renderCamera: PerspectiveCamera,
    private astroControls: AstroControls
  ) {
    super()
  }

  public handle(): Promise<void> | void {
    const actorId: number = this.model.getAttribute('id')!
    const name: string = this.model.attributes.name!
    // Re-resolve against the current scene: observers can retain detached objects.
    const targetPosition: Vector3 = new Vector3()
    const resolveTarget = (): boolean => {
      const scene = this.sceneObserver.scene
      const target: Object3D | undefined = this.sceneObserver.objects.find(object => {
        if (object.model?.getAttribute('id') !== actorId) return false
        let root: Object3D = object
        while (root.parent) root = root.parent
        return root === scene
      })
      if (!target) return false
      target.getWorldPosition(targetPosition)
      return true
    }
    if (!resolveTarget()) return

    const isBlackHole: boolean = this.model.category?.getAttribute('alias') === 'blackHole'
    const offset: number = isBlackHole
      ? new BlackHoleParameters(this.model).simulationRadiusUnits * 1.3
      : toThreeJSUnits(this.model.physicalObject!.getAttribute('radius')!) * 3
    const cameraPosition: Vector3 = this.renderCamera.getWorldPosition(new Vector3())
    const forward: Vector3 = this.renderCamera.getWorldDirection(new Vector3())
    const toTarget: Vector3 = targetPosition.clone().sub(cameraPosition)
    const active: ActiveFlight | null = CameraToObjectTransition.active
    const decision: FlightDecision = decideFlight(
      active?.target ?? null, actorId, toTarget.length(), offset, forward.dot(toTarget.normalize())
    )
    if (decision === 'ignore') return
    if (decision === 'arrived') {
      this.notifications.dispatch({ type: 'success', message: `Target acquired: ${name}` })
      return
    }
    if (active) active.timeline.pause()
    const speedBefore: number = active ? active.speedBefore : this.camera.speed
    this.camera.stopFollowing()
    this.astroControls.enabled = false
    this.menu.close()

    const timeline: anime.AnimeTimelineInstance = anime.timeline()
    const restore = (): void => {
      this.astroControls.enabled = true
      this.camera.setSpeed(speedBefore)
    }
    CameraToObjectTransition.active = { target: actorId, timeline, speedBefore, restore }
    const valid = (): boolean => {
      if (CameraToObjectTransition.active?.timeline !== timeline) return false
      if (resolveTarget()) return true
      CameraToObjectTransition.cancelActive()
      return false
    }
    const startRotation: Quaternion = this.renderCamera.quaternion.clone()
    const endRotation: Quaternion = new Quaternion()
    const turn = { t: 0 }
    const travel = { t: 0 }
    const initialOffset: Vector3 = new Vector3()
    const arrivalOffset: Vector3 = new Vector3()
    const worldPosition: Vector3 = new Vector3()
    const lastPosition: Vector3 = new Vector3()
    let lastTime: number | null = null
    let travelStarted: boolean = false
    const startTravel = (): void => {
      if (travelStarted) return
      // Turn-only motion must not translate the camera at travel progress zero.
      initialOffset.copy(this.renderCamera.getWorldPosition(worldPosition)).sub(targetPosition)
      arrivalOffset.copy(initialOffset)
      if (arrivalOffset.lengthSq() === 0) arrivalOffset.copy(this.renderCamera.getWorldDirection(new Vector3())).negate()
      arrivalOffset.setLength(offset)
      travelStarted = true
    }
    timeline.add({
      targets: turn,
      t: 1,
      duration: 2000,
      easing: 'easeInQuad',
      update: (): void => {
        if (!valid()) return
        this.renderCamera.lookAt(targetPosition)
        endRotation.copy(this.renderCamera.quaternion)
        this.renderCamera.quaternion.slerpQuaternions(startRotation, endRotation, turn.t)
      }
    })
    timeline.add({
      targets: travel,
      t: 1,
      duration: 5000,
      easing: 'easeOutQuint',
      direction: 'normal',
      begin: (): void => {
        if (!valid()) return
        startTravel()
      },
      update: (): void => {
        if (!valid()) return
        startTravel()
        worldPosition.lerpVectors(initialOffset, arrivalOffset, travel.t).add(targetPosition)
        // Store local coordinates even when the render camera has a transformed parent.
        if (this.renderCamera.parent) this.renderCamera.parent.worldToLocal(worldPosition)
        this.renderCamera.position.copy(worldPosition)
        this.renderCamera.lookAt(targetPosition)
        this.renderCamera.getWorldPosition(worldPosition)
        const now: number = performance.now()
        if (lastTime !== null && now > lastTime) {
          const unitsPerSecond: number = worldPosition.distanceTo(lastPosition) / ((now - lastTime) / 1000)
          this.camera.setSpeed(fromKilometers(unitsPerSecond))
        }
        lastPosition.copy(worldPosition)
        lastTime = now
      },
      complete: (): void => {
        if (!valid()) return
        CameraToObjectTransition.active = null
        restore()
        this.notifications.dispatch({ type: 'success', message: `Target acquired: ${name}` })
      }
    })
  }
}

export { CameraToObjectTransition }
