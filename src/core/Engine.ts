import { inject, injectable } from 'inversify'
import { EventEmitter } from '@/core/framework/EventEmitter'
import { SceneManagerV2 } from '@/core/services/SceneManagerV2'
import { SceneObserver } from '@/core/services/SceneObserver'
import { threeJS } from '@/core/graphic/ThreeJS'
import { postprocessing } from '@/core/graphic/Postprocessing'
import { config } from '@/core/framework/config'
import { DAY } from '@/core/constants'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { cameraStore } from '@/ui/mobx/CameraStore'
import { timeStore } from '@/ui/mobx/TimeStore'

@injectable()
class Engine extends EventEmitter {
  private readonly canvas: HTMLCanvasElement
  private readonly overlay: HTMLElement

  private initialized: boolean = false
  private running: boolean = false

  private readonly boundOnStart: () => void
  private readonly boundOnResize: () => void
  private readonly boundOnVisibilityChange: () => void
  private readonly boundOnFrameRendered: () => void

  public constructor(
    @inject('SceneManagerV2') private sceneManagerV2: SceneManagerV2,
    @inject('SceneObserver') private sceneObserver: SceneObserver
  ) {
    super()
    this.canvas = threeJS.renderer.domElement
    this.overlay = threeJS.labelRenderer.domElement
    this.boundOnStart = this.onStart.bind(this)
    this.boundOnResize = this.onResize.bind(this)
    this.boundOnVisibilityChange = this.onVisibilityChange.bind(this)
    this.boundOnFrameRendered = this.onFrameRendered.bind(this)

    addEventListener('resize', this.boundOnResize)
    addEventListener('visibilitychange', this.boundOnVisibilityChange)
  }

  public initialize(): void {
    this.initialized = true
    this.canvas.id = 'canvas'
    this.canvas.style.position = 'absolute'
    this.canvas.style.zIndex = '99'

    this.overlay.id = 'overlay'
    threeJS.stats.dom.style.zIndex = '99999'

    document.body.appendChild(this.canvas)
    document.body.appendChild(this.overlay)

    if (config('showStats')) {
      document.body.appendChild(threeJS.stats.dom)
    }

    this.sceneManagerV2.initialize()
    postprocessing.initialize()

    this.sceneObserver.observable = threeJS.astroControls
    this.sceneObserver.scene = threeJS.scene

    this.onStart()
  }

  public start(): void {
    if (!this.running) {
      this.running = true
      if (!this.initialized) this.initialize()

      this.update()
    }
  }

  public stop(): void {
    threeJS.renderer.setAnimationLoop(null)

    this.running = false
  }

  public update(): void {
    if (this.running) {
      this.onFrameRendered()
    }
  }

  public dispose(): void {
    if (!this.running) return

    removeEventListener('wheel', this.boundOnStart)
    removeEventListener('resize', this.boundOnResize)
    removeEventListener('visibilitychange', this.boundOnVisibilityChange)

    this.initialized = false

    this.stop()
  }

  private onStart(): void {
    this.canvas.addEventListener('wheel', (event: WheelEvent): void => {
      cameraStore.adjustSpeed(event.deltaY)
    })
  }

  private onFrameRendered(): void {
    const delta: number = threeJS.clock.getDelta()

    threeJS.stats.update()
    timeStore.setEpoch(timeStore.epoch + (delta * timeStore.speedOfTime) / DAY)
    threeJS.astroControls.movementSpeed = toThreeJSUnits(cameraStore.speed)
    threeJS.astroControls.update(delta)
    threeJS.labelRenderer.render(threeJS.scene, threeJS.camera)
    postprocessing.render(delta)
    this.sceneManagerV2.update(delta)

    threeJS.renderer.setAnimationLoop(this.boundOnFrameRendered)
  }

  private onResize(): void {
    const { innerHeight, innerWidth } = window

    threeJS.renderer.setSize(innerWidth, innerHeight)
    threeJS.camera.aspect = innerWidth / innerHeight
    threeJS.camera.updateProjectionMatrix()
  }

  private onVisibilityChange(): void {
    if (document.hidden) {
      console.warn('Stopping app due to visibility change')
      this.stop()
    } else {
      console.info('Starting app after visibility change')
      this.start()
    }
  }
}

export { Engine }
