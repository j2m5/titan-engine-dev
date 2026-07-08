import { Command } from '@/core/framework/commands/Command'
import { Actor } from '@/core/models/Actor'
import { Quaternion, Vector3 } from 'three'
import { ObservableRecord, SceneObserver } from '@/core/services/SceneObserver'
import { BlackHoleParameters } from '@/core/renderables/BlackHole'
import { threeJS } from '@/core/graphic/ThreeJS'
import { fromKilometers, toThreeJSUnits } from '@/core/helpers/scaling'
import anime from 'animejs'
import { CameraController } from '@/core/camera/CameraController'
import { NotificationSink } from '@/core/ports/NotificationSink'
import { MenuController } from '@/core/ports/MenuController'

interface CameraToObjectTransitionArgs {
  model: Actor
}

class CameraToObjectTransition extends Command<CameraToObjectTransitionArgs> {
  declare public model: Actor

  public constructor(
    private sceneObserver: SceneObserver,
    private camera: CameraController,
    private notifications: NotificationSink,
    private menu: MenuController
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
      const radius: number = toThreeJSUnits(this.model.physicalObject!.getAttribute('radius'))
      offset = radius * 3
    }

    const alpha: number = (data.distance - offset) / data.distance
    const destination: Vector3 = new Vector3().lerpVectors(this.sceneObserver.cameraPosition, data.position, alpha)
    const currentSpeed: number = this.camera.speed

    let lastValue: number,
      lastTime: number,
      speed: number = 0

    const startRotation: Quaternion = threeJS.camera.quaternion.clone()
    threeJS.camera.lookAt(data.position)

    const endRotation: Quaternion = threeJS.camera.quaternion.clone()
    threeJS.camera.quaternion.copy(startRotation)

    const transition: { t: number } = { t: 0 }

    const lookAt: anime.AnimeParams = {
      targets: transition,
      t: 1,
      duration: 2000,
      easing: 'easeInQuad',
      update: (): void => {
        threeJS.camera.quaternion.slerp(endRotation, transition.t)
      }
    }

    const path: anime.AnimeParams = {
      targets: [threeJS.camera.position],
      x: destination.x,
      y: destination.y,
      z: destination.z,
      easing: 'easeOutQuint',
      duration: 5000,
      direction: 'normal',
      begin: (): void => {
        threeJS.astroControls.enabled = false
        this.menu.close()
      },
      update: (anim: anime.AnimeInstance): void => {
        const currentTime: number = +new Date()
        const currentValue: string = anim.animations[0].currentValue

        if (lastValue !== 0 && lastTime !== 0) {
          speed = (Number(currentValue) - lastValue) / (currentTime - lastTime) / threeJS.clock.getDelta()
        }

        lastValue = Number(currentValue)
        lastTime = currentTime

        this.camera.setSpeed(fromKilometers(Math.abs(speed)))
      },
      complete: (): void => {
        threeJS.astroControls.enabled = true
        this.notifications.dispatch({ type: 'success', message: `Target acquired: ${data.name}` })
        this.camera.setSpeed(currentSpeed)
      }
    }

    const timeline: anime.AnimeTimelineInstance = anime.timeline()

    timeline.add(lookAt)
    timeline.add(path)
  }
}

export { CameraToObjectTransition }
