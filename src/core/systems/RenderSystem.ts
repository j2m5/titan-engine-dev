import { System } from '@/core/framework/System'
import { Entity } from '@/core/framework/Entity'
import { Engine } from '@/core/Engine'
import { threeJS } from '@/core/graphic/ThreeJS'
import { RenderManager } from '@/core/services/RenderManager'
import { timeStore } from '@/ui/mobX/TimeStore'
import { cameraStore } from '@/ui/mobX/CameraStore'
import { DAY } from '@/core/constants'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Object3D } from 'three'
import { inject, injectable } from 'inversify'

@injectable()
class RenderSystem extends System {
  private readonly canvas: HTMLCanvasElement
  private readonly overlay: HTMLElement

  public constructor(@inject('RenderManager') private renderManager: RenderManager) {
    super()
    this.canvas = threeJS.renderer.domElement
    this.overlay = threeJS.labelRenderer.domElement
  }

  public appliesTo(entity: Entity): boolean {
    return entity.hasComponent(Object3D)
  }

  public initialize(engine: Engine): void {
    this.canvas.id = 'canvas'
    this.canvas.style.position = 'absolute'
    this.canvas.style.zIndex = '99'

    this.overlay.id = 'overlay'

    document.body.appendChild(this.canvas)
    document.body.appendChild(this.overlay)

    this.renderManager.initialize()
    this.registerEvents()
  }

  public update(dt: number, engine: Engine): void {
    timeStore.setEpoch(timeStore.epoch + (dt * timeStore.speedOfTime) / DAY)
    threeJS.astroControls.movementSpeed = toThreeJSUnits(cameraStore.speed)
    threeJS.astroControls.update(dt)
    threeJS.labelRenderer.render(threeJS.scene, threeJS.camera)
    this.renderManager.render(dt)
  }

  private registerEvents(): void {
    this.canvas.addEventListener('wheel', (event: WheelEvent): void => {
      cameraStore.adjustSpeed(event.deltaY)
    })
  }
}

export { RenderSystem }
