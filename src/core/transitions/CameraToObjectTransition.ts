import { Command } from '@/core/framework/commands/Command'
import { Actor } from '@/core/models/Actor'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { ObservableRecord, SceneObserver } from '@/core/services/SceneObserver'
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
  activeTarget: string | null,
  target: string,
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
  target: string
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
    const data: ObservableRecord | undefined = this.sceneObserver.getData(this.model.attributes.name!)

    if (!data) return

    const isBlackHole: boolean = this.model.category?.getAttribute('alias') === 'blackHole'

    let offset: number

    if (isBlackHole) {
      const parameters: BlackHoleParameters = new BlackHoleParameters(this.model)
      offset = parameters.simulationRadiusUnits * 1.3
    } else {
      const radius: number = toThreeJSUnits(this.model.physicalObject!.getAttribute('radius')!)
      offset = radius * 3
    }

    const cameraPosition: Vector3 = this.sceneObserver.cameraPosition
    const forward: Vector3 = new Vector3(0, 0, -1).applyQuaternion(this.renderCamera.quaternion)
    const toTarget: Vector3 = data.position.clone().sub(cameraPosition).normalize()
    const active: ActiveFlight | null = CameraToObjectTransition.active
    const decision: FlightDecision = decideFlight(
      active?.target ?? null,
      data.name,
      data.distance,
      offset,
      forward.dot(toTarget)
    )

    if (decision === 'ignore') return

    if (decision === 'arrived') {
      this.notifications.dispatch({ type: 'success', message: `Target acquired: ${data.name}` })

      return
    }

    // Разворот: прежний полёт стоит, а скорость после прилёта — та, что была до
    // первого клика цепочки, а не разогнанная анимацией в момент разворота
    if (decision === 'redirect' && active) active.timeline.pause()

    const speedBefore: number = active ? active.speedBefore : this.camera.speed

    const alpha: number = (data.distance - offset) / data.distance
    const destination: Vector3 = new Vector3().lerpVectors(cameraPosition, data.position, alpha)

    // Скорость на виджете — пройденный за кадр путь в км/с по СВОЕМУ замеру
    // времени. Общие часы движка (getDelta) трогать нельзя: каждый вызов крал
    // дельту у кадра, и симуляция, управление и постпроцессинг шли рывками
    const lastPosition: Vector3 = new Vector3()
    let lastTime: number | null = null

    const startRotation: Quaternion = this.renderCamera.quaternion.clone()
    this.renderCamera.lookAt(data.position)

    const endRotation: Quaternion = this.renderCamera.quaternion.clone()
    this.renderCamera.quaternion.copy(startRotation)

    const transition: { t: number } = { t: 0 }

    const lookAt: anime.AnimeParams = {
      targets: transition,
      t: 1,
      duration: 2000,
      easing: 'easeInQuad',
      update: (): void => {
        this.renderCamera.quaternion.slerp(endRotation, transition.t)
      }
    }

    const path: anime.AnimeParams = {
      targets: [this.renderCamera.position],
      x: destination.x,
      y: destination.y,
      z: destination.z,
      easing: 'easeOutQuint',
      duration: 5000,
      direction: 'normal',
      begin: (): void => {
        this.astroControls.enabled = false
        this.menu.close()
      },
      update: (): void => {
        const now: number = performance.now()

        // Первый кадр — только опорная точка: скорости ещё не из чего считать
        if (lastTime !== null && now > lastTime) {
          const unitsPerSecond: number = this.renderCamera.position.distanceTo(lastPosition) / ((now - lastTime) / 1000)

          this.camera.setSpeed(fromKilometers(unitsPerSecond))
        }

        lastPosition.copy(this.renderCamera.position)
        lastTime = now
      },
      complete: (): void => {
        // Прерванный разворотом полёт не возвращает управление и скорость:
        // это делает только последний
        if (CameraToObjectTransition.active?.timeline !== timeline) return

        CameraToObjectTransition.active = null
        this.astroControls.enabled = true
        this.notifications.dispatch({ type: 'success', message: `Target acquired: ${data.name}` })
        this.camera.setSpeed(speedBefore)
      }
    }

    const timeline: anime.AnimeTimelineInstance = anime.timeline()

    CameraToObjectTransition.active = {
      target: data.name,
      timeline,
      speedBefore,
      restore: (): void => {
        this.astroControls.enabled = true
        this.camera.setSpeed(speedBefore)
      }
    }

    timeline.add(lookAt)
    timeline.add(path)
  }
}

export { CameraToObjectTransition }
