import type { PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three'
import { Pass } from 'postprocessing'
import { OVERLAY_LAYER } from '@/core/graphic/passes/DepthVolume'

/**
 * OverlayPass — схематичные объекты (линии орбит) поверх готового кадра.
 *
 * В основном проходе линии попадали в копию кадра и сдвигались линзами чёрной
 * дыры вместе с фоном. Здесь сцена рендерится с маской OVERLAY_LAYER после
 * проходов лензирования: линии ложатся прямыми, а атмосфера, идущая следом,
 * тонирует их так же, как тонировала в основном проходе. Рисуется в
 * inputBuffer (needsSwap = false); обход графа за кадр — без отрисовки
 * обычных объектов.
 */
export class OverlayPass extends Pass {
  private readonly overlayScene: Scene
  private readonly sceneCamera: PerspectiveCamera

  public constructor(scene: Scene, camera: PerspectiveCamera) {
    super('OverlayPass')
    this.overlayScene = scene
    this.sceneCamera = camera
    this.needsSwap = false
  }

  public override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    _outputBuffer?: WebGLRenderTarget | null
  ): void {
    const camera = this.sceneCamera
    const mask = camera.layers.mask
    const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate

    camera.layers.set(OVERLAY_LAYER)
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer)
    renderer.render(this.overlayScene, camera)

    camera.layers.mask = mask
    renderer.shadowMap.autoUpdate = shadowMapAutoUpdate
  }
}
