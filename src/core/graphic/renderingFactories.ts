import { Clock, NoToneMapping, PerspectiveCamera, Scene, Sphere, SRGBColorSpace, WebGLRenderer } from 'three'
import type { WebGLRendererParameters } from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { AstroControls } from '@/core/libs/AstroControls'

/**
 * Кламп devicePixelRatio: на 4K/Retina честные 2-3x пикселей поверх MSAA 8x
 * композера — неоправданная цена. 2.0 достаточно для резкости UI-масштабов.
 */
export function clampPixelRatio(devicePixelRatio: number, maxPixelRatio: number): number {
  return Math.min(devicePixelRatio, maxPixelRatio)
}

export function createRenderer(options: WebGLRendererParameters, maxPixelRatio: number = 2): WebGLRenderer {
  const renderer: WebGLRenderer = new WebGLRenderer(options)
  renderer.setPixelRatio(clampPixelRatio(window.devicePixelRatio, maxPixelRatio))
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

export function createScene(cfg: { name: string }): Scene {
  const scene: Scene = new Scene()
  scene.name = cfg.name

  return scene
}

export function createCamera(cfg: { fov: number; aspect: number; near: number; far: number }): PerspectiveCamera {
  return new PerspectiveCamera(cfg.fov, cfg.aspect, cfg.near, cfg.far)
}

/**
 * `cameraSphere` больше не самостоятельная сущность: он нужен исключительно
 * для конструирования контролов, поэтому живёт здесь.
 */
export function createAstroControls(
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
  cfg: { rollSpeed: number; autoForward: boolean }
): AstroControls {
  const sphere: Sphere = new Sphere(camera.position.clone(), 0.000001)
  const controls: AstroControls = new AstroControls(camera, sphere, renderer.domElement)
  controls.rollSpeed = cfg.rollSpeed
  controls.autoForward = cfg.autoForward

  return controls
}

export function createClock(cfg: { startTime: number }): Clock {
  const clock: Clock = new Clock()
  clock.startTime = cfg.startTime

  return clock
}
