import { SceneManager } from '@/core/services/SceneManager'
import { SceneObserver } from '@/core/services/SceneObserver'
import { CameraCollision } from '@/core/services/CameraCollision'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { SimulationClock } from '@/core/time/SimulationClock'
import { CameraController } from '@/core/camera/CameraController'
import { UpdateContext } from '@/core/UpdateContext'
import { Clock, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer } from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { AstroControls } from '@/core/libs/AstroControls'
import Stats from 'three/examples/jsm/libs/stats.module'
import { clampPixelRatio } from '@/core/graphic/renderingFactories'

class Engine {
  private readonly canvas: HTMLCanvasElement
  private readonly overlay: HTMLElement

  private initialized: boolean = false
  private running: boolean = false

  private readonly boundOnResize: () => void
  private readonly boundOnFrameRendered: () => void
  private readonly boundOnClick: (event: MouseEvent) => void
  private readonly boundOnWheel: (event: WheelEvent) => void

  private readonly raycaster: Raycaster = new Raycaster()
  /**
   * Панель статистики создаётся только когда её показывают: её конструктор
   * строит канвас и берёт 2D-контекст, чего в среде без канваса нет.
   */
  private readonly stats: Stats | null = config('showStats') ? new Stats() : null

  public constructor(
    private sceneManager: SceneManager,
    private sceneObserver: SceneObserver,
    private clock: SimulationClock,
    private camera: CameraController,
    private renderer: WebGLRenderer,
    private labelRenderer: CSS2DRenderer,
    private scene: Scene,
    private renderCamera: PerspectiveCamera,
    private astroControls: AstroControls,
    private renderClock: Clock,
    private postprocessing: Postprocessing,
    private cameraCollision: CameraCollision
  ) {
    this.canvas = this.renderer.domElement
    this.overlay = this.labelRenderer.domElement

    if (this.stats) {
      this.stats.showPanel(0)
      this.stats.showPanel(1)
      this.stats.showPanel(2)
    }

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

    document.body.appendChild(this.canvas)
    document.body.appendChild(this.overlay)

    if (this.stats) {
      this.stats.dom.style.zIndex = '9999999999999'
      document.body.appendChild(this.stats.dom)
    }

    this.sceneManager.initialize()
    this.postprocessing.initialize()

    this.sceneObserver.observable = this.astroControls
    this.sceneObserver.scene = this.scene

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
    this.renderer.setAnimationLoop(null)

    this.running = false
  }

  public update(): void {
    if (this.running) {
      this.onFrameRendered()
    }
  }

  /**
   * Разборка сценария. Гарда на `running` здесь нет намеренно: метод должен
   * работать и на остановленном движке, иначе выход в меню с последующим
   * входом оставляет предыдущую сцену в графе.
   *
   * Порядок важен: луп останавливается последним — сначала перестаём быть
   * в сцене, потом перестаём её рисовать.
   *
   * Снимается только слушатель `wheel`: он регистрируется в `onStart()` и
   * принадлежит сценарию. Слушатели `resize` и `click` регистрируются в
   * конструкторе и живут всё время жизни движка-контейнера — их снятие здесь
   * означало бы, что после разборки сценария навсегда пропадают обработка
   * ресайза окна и клик-по-объекту-в-прицел.
   */
  public dispose(): void {
    this.sceneManager.dispose()
    this.postprocessing.dispose()
    this.sceneObserver.dispose()

    this.canvas.removeEventListener('wheel', this.boundOnWheel)

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
    const delta: number = this.renderClock.getDelta()

    this.stats?.update()
    this.clock.advance(delta)
    this.astroControls.movementSpeed = toThreeJSUnits(this.camera.speed)
    this.astroControls.update(delta)
    this.labelRenderer.render(this.scene, this.renderCamera)

    const ctx: UpdateContext = {
      delta,
      epoch: this.clock.epoch,
      elapsed: this.renderClock.getElapsedTime(),
      camera: this.renderCamera
    }

    this.sceneManager.update(ctx)
    this.cameraCollision.resolve()
    this.postprocessing.render(delta)

    this.renderer.setAnimationLoop(this.boundOnFrameRendered)
  }

  private onResize(): void {
    const { innerHeight, innerWidth } = window

    // Порядок несущий: pixelRatio ДО setSize композера — composer.setSize
    // меряет таргеты в drawing-buffer-пикселях (size × ratio).
    // Кламп 2 — тот же, что в createRenderer (см. renderingFactories).
    this.renderer.setPixelRatio(clampPixelRatio(window.devicePixelRatio, 2))
    this.renderer.setSize(innerWidth, innerHeight)
    this.labelRenderer.setSize(innerWidth, innerHeight)
    this.postprocessing.setSize(innerWidth, innerHeight)
    this.renderCamera.aspect = innerWidth / innerHeight
    this.renderCamera.updateProjectionMatrix()
  }

  private onClick(event: MouseEvent): void {
    const mouse = new Vector2()

    event.preventDefault()

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

    this.raycaster.setFromCamera(mouse, this.renderCamera)

    const intersects = this.raycaster.intersectObjects(this.scene.getObjectsByUserDataProperty('clickable', true))

    if (intersects.length) {
      const target = intersects.find((el) => el.object.userData.clickable !== undefined)

      target?.object.parent?.add(this.sceneManager.crosshair)
    } else {
      this.sceneManager.crosshair.parent?.remove(this.sceneManager.crosshair)
    }
  }
}

export { Engine }
