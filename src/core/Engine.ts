import { EventEmitter } from '@/core/framework/EventEmitter'
import { SceneManager } from '@/core/services/SceneManager'
import { SceneObserver } from '@/core/services/SceneObserver'
import { threeJS } from '@/core/graphic/ThreeJS'
import { postprocessing } from '@/core/graphic/Postprocessing'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { SimulationClock } from '@/core/time/SimulationClock'
import { CameraController } from '@/core/camera/CameraController'
import { UpdateContext } from '@/core/UpdateContext'
import { Vector2 } from 'three'

class Engine extends EventEmitter {
  private readonly canvas: HTMLCanvasElement
  private readonly overlay: HTMLElement

  private initialized: boolean = false
  private running: boolean = false

  private readonly boundOnResize: () => void
  private readonly boundOnFrameRendered: () => void
  private readonly boundOnClick: (event: MouseEvent) => void
  private readonly boundOnWheel: (event: WheelEvent) => void

  public constructor(
    private sceneManager: SceneManager,
    private sceneObserver: SceneObserver,
    private clock: SimulationClock,
    private camera: CameraController
  ) {
    super()
    this.canvas = threeJS.renderer.domElement
    this.overlay = threeJS.labelRenderer.domElement
    this.boundOnResize = this.onResize.bind(this)
    this.boundOnFrameRendered = this.onFrameRendered.bind(this)
    this.boundOnClick = this.onClick.bind(this)
    this.boundOnWheel = this.onWheel.bind(this)

    addEventListener('resize', this.boundOnResize)
    this.canvas.addEventListener('click', this.boundOnClick)
  }

  public initialize(): void {
    this.initialized = true
    this.canvas.id = 'canvas'
    this.canvas.style.position = 'absolute'
    this.canvas.style.zIndex = '99'

    this.overlay.id = 'overlay'
    threeJS.stats.dom.style.zIndex = '9999999999999'

    document.body.appendChild(this.canvas)
    document.body.appendChild(this.overlay)

    if (config('showStats')) document.body.appendChild(threeJS.stats.dom)

    this.sceneManager.initialize()
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

    this.canvas.removeEventListener('wheel', this.boundOnWheel)
    removeEventListener('resize', this.boundOnResize)
    this.canvas.removeEventListener('click', this.boundOnClick)

    this.initialized = false

    this.stop()
  }

  private onStart(): void {
    this.canvas.addEventListener('wheel', this.boundOnWheel)
  }

  private onWheel(event: WheelEvent): void {
    this.camera.adjust(event.deltaY)
  }

  private onFrameRendered(): void {
    const delta: number = threeJS.clock.getDelta()

    if (config('showStats')) threeJS.stats.update()
    this.clock.advance(delta)
    threeJS.astroControls.movementSpeed = toThreeJSUnits(this.camera.speed)
    threeJS.astroControls.update(delta)
    threeJS.labelRenderer.render(threeJS.scene, threeJS.camera)

    const ctx: UpdateContext = { delta, epoch: this.clock.epoch }

    this.sceneManager.update(ctx)
    postprocessing.render(delta)

    threeJS.renderer.setAnimationLoop(this.boundOnFrameRendered)
  }

  private onResize(): void {
    const { innerHeight, innerWidth } = window

    threeJS.renderer.setSize(innerWidth, innerHeight)
    threeJS.camera.aspect = innerWidth / innerHeight
    threeJS.camera.updateProjectionMatrix()
  }

  private onClick(event: MouseEvent): void {
    const mouse = new Vector2()

    event.preventDefault()

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

    threeJS.raycaster.setFromCamera(mouse, threeJS.camera)

    const intersects = threeJS.raycaster.intersectObjects(threeJS.scene.getObjectsByUserDataProperty('clickable', true))

    if (intersects.length) {
      const target = intersects.find((el) => el.object.userData.clickable !== undefined)

      target?.object.parent?.add(this.sceneManager.crosshair)
    } else {
      this.sceneManager.crosshair.parent?.remove(this.sceneManager.crosshair)
    }
  }
}

export { Engine }
