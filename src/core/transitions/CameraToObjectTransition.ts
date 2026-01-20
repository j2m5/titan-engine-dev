import { Command } from '@/core/framework/commands/Command'
import { Actor } from '@/core/models/Actor'
import { Quaternion, Vector3 } from 'three'
import { inject, injectable } from 'inversify'
import { ObservableRecord, SceneObserver } from '@/core/services/SceneObserver'
import { threeJS } from '@/core/graphic/ThreeJS'
import { menuStore } from '@/ui/mobx/MenuStore'
import { cameraStore } from '@/ui/mobx/CameraStore'
import { fromKilometers, toThreeJSUnits } from '@/core/helpers/scaling'
import { notificationStore } from '@/ui/mobx/NotificationStore'
import anime from 'animejs'

interface CameraToObjectTransitionArgs {
  model: Actor
}

@injectable()
class CameraToObjectTransition extends Command<CameraToObjectTransitionArgs> {
  declare public model: Actor

  public constructor(@inject('SceneObserver') private sceneObserver: SceneObserver) {
    super()
  }

  public handle(): Promise<void> | void {
    const data: ObservableRecord | undefined = this.sceneObserver.getData(this.model.attributes.name!)

    if (!data) return

    const radius: number = toThreeJSUnits(this.model.physicalObject!.getAttribute('radius'))
    const offset: number = radius * 3
    const alpha: number = (data.distance - offset) / data.distance
    const destination: Vector3 = new Vector3().lerpVectors(this.sceneObserver.cameraPosition, data.position, alpha)
    const currentSpeed: number = cameraStore.speed

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
      duration: 1000,
      direction: 'normal',
      begin: (): void => {
        threeJS.astroControls.enabled = false
        menuStore.closeMenu()
      },
      update: (anim: anime.AnimeInstance): void => {
        const currentTime: number = +new Date()
        const currentValue: string = anim.animations[0].currentValue

        if (lastValue !== 0 && lastTime !== 0) {
          speed = (Number(currentValue) - lastValue) / (currentTime - lastTime) / threeJS.clock.getDelta()
        }

        lastValue = Number(currentValue)
        lastTime = currentTime

        cameraStore.setSpeed(fromKilometers(Math.abs(speed)))
      },
      complete: (): void => {
        threeJS.astroControls.enabled = true
        notificationStore.dispatch({ type: 'success', message: 'Completed' })
        cameraStore.setSpeed(currentSpeed)
      }
    }

    const timeline: anime.AnimeTimelineInstance = anime.timeline()

    timeline.add(lookAt)
    timeline.add(path)
  }
}

export { CameraToObjectTransition }
