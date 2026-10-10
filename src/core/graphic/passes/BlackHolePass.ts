import {
  BasicDepthPacking,
  type CubeTexture,
  HalfFloatType,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { CopyPass, DepthCopyPass, Pass } from 'postprocessing'
import type { LensRegistry } from '@/core/services/LensRegistry'
import { BLACK_HOLE_LAYER, isSceneFrameConsumer, type SceneFrameConsumer } from '@/core/graphic/passes/DepthVolume'
import { isVisibleInTree } from '@/core/graphic/passes/DepthVolumePass'
import { SkyLayer } from '@/core/graphic/passes/SkyLayer'

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
 *
 * Перед мешами рисуется слой видимого неба (SkyLayer, общий с дальним полем
 * линзы): ветки кадра вычитают его из копии и читают небо по искривлённому
 * лучу. Кадр без дыры слой гасит (reset).
 */
export class BlackHolePass extends Pass {
  public readonly depthCopy: DepthCopyPass
  public readonly colorCopy: CopyPass
  public readonly skyLayer: SkyLayer
  private readonly sceneCamera: PerspectiveCamera
  private readonly registry: LensRegistry
  private readonly visible: SceneFrameConsumer[] = []
  /** Кубмапа фона первой видимой дыры (режим cubemap; в режиме gaia — null) */
  private background: CubeTexture | null = null

  public constructor(camera: PerspectiveCamera, registry: LensRegistry, skyLayer: SkyLayer = new SkyLayer()) {
    super('BlackHolePass')
    this.sceneCamera = camera
    this.registry = registry
    this.skyLayer = skyLayer
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
    this.skyLayer.setSize(width, height)
  }

  public override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
    deltaTime?: number,
    stencilTest?: boolean
  ): void {
    const meshes = this.collectVisible()
    if (meshes.length === 0) {
      this.skyLayer.reset()
      return
    }

    this.depthCopy.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)
    this.colorCopy.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)

    const camera = this.sceneCamera
    const mask = camera.layers.mask
    const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate
    const logFarFactor = Math.log2(camera.far + 1)
    renderer.shadowMap.autoUpdate = false

    // Видимое небо кадра — до мешей: его вычитают из копии проходы линзы
    this.skyLayer.render(renderer, camera, this.depthCopy.texture, this.background)
    const skyLayer = this.skyLayer.target.texture

    camera.layers.set(BLACK_HOLE_LAYER)
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer)

    for (const mesh of meshes) {
      mesh.bindSceneFrame(this.colorCopy.texture, this.depthCopy.texture, skyLayer, logFarFactor)
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
    this.background = null
    for (const entry of this.registry.entries()) {
      const object = entry.object
      if (!isSceneFrameConsumer(object) || !isVisibleInTree(object)) continue
      if (out.length === 0) this.background = entry.background()
      out.push(object)
    }
    return out
  }

  public override dispose(): void {
    this.depthCopy.dispose()
    this.colorCopy.dispose()
    this.skyLayer.dispose()
    super.dispose()
  }
}
