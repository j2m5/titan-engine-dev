import { Application } from '@/Application.ts'
import { Entity } from '@/core/framework/Entity'
import { LinearSRGBColorSpace, Quaternion, Vector3 } from 'three'
import anime from 'animejs/lib/anime.es'
import { threeJS } from '@/core/graphic/ThreeJS'
import { StarSystemAppState } from '@/core/services/states/StarSystemAppState.ts'
import { Actor } from '@/core/models/Actor'
import { AppState } from '@/core/services/states/AppState.ts'

class TransitionReceiver {
  public transitionToStarSystem(context: Application, starSystem: Entity): void {
    const position: Vector3 = starSystem.getComponent(Actor).placement
      ? new Vector3(
          starSystem.getComponent(Actor).placement.getAttribute('x', 0),
          starSystem.getComponent(Actor).placement.getAttribute('y', 0),
          starSystem.getComponent(Actor).placement.getAttribute('z', 0)
        )
      : new Vector3()

    const startRotation: Quaternion = threeJS.camera.quaternion.clone()
    threeJS.camera.lookAt(position)

    const endRotation: Quaternion = threeJS.camera.quaternion.clone()
    threeJS.camera.quaternion.copy(startRotation)

    const animation: { t: number } = { t: 0 }

    const lookAt: anime.AnimeParams = {
      targets: animation,
      t: 1,
      duration: 1500,
      easing: 'easeInQuad',
      update: (): void => {
        threeJS.camera.quaternion.slerp(endRotation, animation.t)
      }
    }

    const transition: anime.AnimeParams = {
      targets: threeJS.camera.position,
      x: position.x,
      y: position.y,
      z: position.z,
      duration: 6000,
      easing: 'easeOutQuint',
      begin: (): void => {
        threeJS.astroControls.enabled = false
        context.renderManager.setActivePipeline('GalaxyWithWarp', threeJS.galaxyScene)
      },
      complete: async (): Promise<void> => {
        threeJS.astroControls.enabled = true
        threeJS.renderer.outputColorSpace = LinearSRGBColorSpace

        const state: AppState = new StarSystemAppState()
        state.setEntityId(starSystem.id)
        await context.setState(state)
      }
    }

    const timeline: anime.AnimeTimelineInstance = anime.timeline()

    timeline.add(lookAt)
    timeline.add(transition)
  }

  public transitionToGalaxy(): void {}
}

export { TransitionReceiver }
