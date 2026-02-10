import { config } from '@/core/framework/config'
import { Clock, NoToneMapping, PerspectiveCamera, Raycaster, Scene, Sphere, SRGBColorSpace, WebGLRenderer } from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { AstroControls } from '@/core/libs/AstroControls'
import Stats from 'three/examples/jsm/libs/stats.module'

class ThreeJS {
  public readonly renderer: WebGLRenderer
  public readonly labelRenderer: CSS2DRenderer
  public readonly galaxyScene: Scene
  public readonly scene: Scene
  public readonly camera: PerspectiveCamera
  public readonly cameraSphere: Sphere
  public readonly astroControls: AstroControls
  public readonly raycaster: Raycaster
  public readonly clock: Clock
  public readonly stats: Stats

  public constructor() {
    this.renderer = this.setRenderer()
    this.labelRenderer = this.setLabelRenderer()
    this.galaxyScene = this.setGalaxyScene()
    this.scene = this.setScene()
    this.camera = this.setCamera()
    this.cameraSphere = this.setCameraSphere()
    this.astroControls = this.setAstroControls()
    this.raycaster = this.setRaycaster()
    this.clock = this.setClock()
    this.stats = this.setStats()
  }

  private setRenderer(): WebGLRenderer {
    const renderer: WebGLRenderer = new WebGLRenderer(config('renderer'))
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = NoToneMapping

    return renderer
  }

  private setLabelRenderer(): CSS2DRenderer {
    const renderer: CSS2DRenderer = new CSS2DRenderer()

    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.top = '0px'

    return renderer
  }

  private setGalaxyScene(): Scene {
    const scene: Scene = new Scene()
    scene.name = 'GalaxyScene'

    return scene
  }

  private setScene(): Scene {
    const scene: Scene = new Scene()
    scene.name = 'MainScene'

    return scene
  }

  private setCamera(): PerspectiveCamera {
    const { fov, aspect, near, far } = config('camera')

    return new PerspectiveCamera(fov, aspect, near, far)
  }

  private setCameraSphere(): Sphere {
    return new Sphere(this.camera.position.clone(), 0.000001)
  }

  private setAstroControls(): AstroControls {
    const controls: AstroControls = new AstroControls(this.camera, this.cameraSphere, this.renderer.domElement)
    controls.rollSpeed = 0.1
    controls.autoForward = false

    return controls
  }

  private setRaycaster(): Raycaster {
    return new Raycaster()
  }

  private setClock(): Clock {
    const clock: Clock = new Clock()
    clock.startTime = 0

    return clock
  }

  private setStats(): Stats {
    const stats: Stats = new Stats()
    stats.showPanel(0)
    stats.showPanel(1)
    stats.showPanel(2)

    return stats
  }
}

export const threeJS: ThreeJS = new ThreeJS()
