import { Clock, NoToneMapping, PerspectiveCamera, Scene, Sphere, SRGBColorSpace, WebGLRenderer } from 'three'
import type { WebGLRendererParameters } from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { AstroControls } from '@/core/libs/AstroControls'

export function createRenderer(options: WebGLRendererParameters): WebGLRenderer {
  const renderer: WebGLRenderer = new WebGLRenderer(options)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NoToneMapping

  return renderer
}

export function createLabelRenderer(): CSS2DRenderer {
  const renderer: CSS2DRenderer = new CSS2DRenderer()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.domElement.style.position = 'absolute'
  renderer.domElement.style.top = '0px'

  return renderer
}

export function createScene(): Scene {
  const scene: Scene = new Scene()
  scene.name = 'MainScene'

  return scene
}

export function createCamera(cfg: { fov: number; aspect: number; near: number; far: number }): PerspectiveCamera {
  return new PerspectiveCamera(cfg.fov, cfg.aspect, cfg.near, cfg.far)
}

/**
 * `cameraSphere` больше не самостоятельная сущность: он нужен исключительно
 * для конструирования контролов, поэтому живёт здесь.
 */
export function createAstroControls(camera: PerspectiveCamera, renderer: WebGLRenderer): AstroControls {
  const sphere: Sphere = new Sphere(camera.position.clone(), 0.000001)
  const controls: AstroControls = new AstroControls(camera, sphere, renderer.domElement)
  controls.rollSpeed = 0.1
  controls.autoForward = false

  return controls
}

export function createClock(): Clock {
  const clock: Clock = new Clock()
  clock.startTime = 0

  return clock
}
