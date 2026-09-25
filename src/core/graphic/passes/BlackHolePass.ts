import {
  BasicDepthPacking,
  HalfFloatType,
  type PerspectiveCamera,
  type Texture,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { CopyPass, DepthCopyPass, Pass } from 'postprocessing'
import type { LensRegistry } from '@/core/services/LensRegistry'
import { BLACK_HOLE_LAYER, isSceneFrameConsumer, type SceneFrameConsumer } from '@/core/graphic/passes/DepthVolume'
import { isVisibleInTree } from '@/core/graphic/passes/DepthVolumePass'

type DepthPacking = Parameters<Pass['setDepthTexture']>[1]

/**
 * BlackHolePass — меш сильной зоны чёрной дыры поверх готового кадра.
 *
 * В основном проходе меш видел только кубмапу и закрывал собой всё, что за
 * дырой. Здесь он рисуется после сцены и объёмов и сэмплирует КОПИЮ кадра:
 * побег луча проецируется в uv, и в сферу попадают тела, лучи и туманности за
 * дырой. Копии нужны обе: сэмплировать аттачменты рисуемого буфера — feedback
 * loop (см. DepthVolumePass), цвет — half-float, чтобы не потерять HDR.
 *
 * Рисуется в inputBuffer (needsSwap = false) с депт-тестом против сцены: тело
 * перед сферой закрывает её, как прежде; свою глубину меш пишет сам (передняя
 * поверхность снаружи, задняя стенка изнутри). Меши берутся из LensRegistry
 * (те же записи, что у экранного прохода дальнего поля), слой BLACK_HOLE_LAYER
 * включается на камере только на время рендера. Кадр без дыры не стоит ничего:
 * копии не делаются.
 */
export class BlackHolePass extends Pass {
  public readonly depthCopy: DepthCopyPass
  public readonly colorCopy: CopyPass
  private readonly sceneCamera: PerspectiveCamera
  private readonly registry: LensRegistry
  private readonly resolution = new Vector2(1, 1)
  private readonly visible: SceneFrameConsumer[] = []

  public constructor(camera: PerspectiveCamera, registry: LensRegistry) {
    super('BlackHolePass')
    this.sceneCamera = camera
    this.registry = registry
    this.needsSwap = false
    this.needsDepthTexture = true
    this.depthCopy = new DepthCopyPass({ depthPacking: BasicDepthPacking })
    this.colorCopy = new CopyPass(new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }), true)
  }

  public override setDepthTexture(depthTexture: Texture, depthPacking?: DepthPacking): void {
    this.depthCopy.setDepthTexture(depthTexture, depthPacking)
  }

  public override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: number): void {
    this.depthCopy.initialize(renderer, alpha, frameBufferType)
    this.colorCopy.initialize(renderer, alpha, frameBufferType)
  }

  public override setSize(width: number, height: number): void {
    this.depthCopy.setSize(width, height)
    this.colorCopy.setSize(width, height)
    this.resolution.set(width, height)
  }

  public override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
    deltaTime?: number,
    stencilTest?: boolean
  ): void {
    const meshes = this.collectVisible()
    if (meshes.length === 0) return

    this.depthCopy.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)
    this.colorCopy.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)

    const camera = this.sceneCamera
    const mask = camera.layers.mask
    const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate
    const logFarFactor = Math.log2(camera.far + 1)

    camera.layers.set(BLACK_HOLE_LAYER)
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer)

    for (const mesh of meshes) {
      mesh.bindSceneFrame(this.colorCopy.texture, this.depthCopy.texture, this.resolution, logFarFactor)
      renderer.render(mesh, camera)
      mesh.unbindSceneFrame()
    }

    camera.layers.mask = mask
    renderer.shadowMap.autoUpdate = shadowMapAutoUpdate
  }

  /** Меши L0 из реестра с видимой цепочкой предков (импостор активен → L0 скрыт) */
  private collectVisible(): SceneFrameConsumer[] {
    const out = this.visible
    out.length = 0
    for (const entry of this.registry.entries()) {
      const object = entry.object
      if (!isSceneFrameConsumer(object) || !isVisibleInTree(object)) continue
      out.push(object)
    }
    return out
  }

  public override dispose(): void {
    this.depthCopy.dispose()
    this.colorCopy.dispose()
    super.dispose()
  }
}
