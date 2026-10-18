import { BasicDepthPacking, Vector2, type PerspectiveCamera, type Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import { DepthCopyPass, Pass } from 'postprocessing'
import { LENS_FRONT_DEPTH_LAYER, LENS_FRONT_LAYER } from '@/core/graphic/passes/DepthVolume'
import { drawDepthVolumes, orderFarToNear } from '@/core/graphic/passes/DepthVolumePass'
import { DepthRestoreMaterial } from '@/core/graphic/passes/DepthRestoreMaterial'
import type { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'
import { DepthVolumeResolutionRenderer } from './DepthVolumeResolutionRenderer'

/** Тип упаковки глубины библиотека объявляет, но не экспортирует — берём из сигнатуры Pass */
type DepthPacking = Parameters<Pass['setDepthTexture']>[1]

/**
 * LensFrontPass — прозрачное перед активной линзой поверх лензированного кадра.
 *
 * LensFrontSorter перенёс такие объекты на LENS_FRONT_LAYER, а передние объёмы
 * DepthVolumePass пропустил. Здесь, после проходов линз, до оверлеев и
 * атмосферы: (1) возврат глубины сцены в текущий буфер — после EffectPass линз
 * композер рисует во второй буфер с чужой глубиной, а кольцо за телом планеты
 * должно оставаться скрытым; (2) сцена с маской слоя 27, а глубина пишущих
 * её объектов (слой 26) — ещё и в буфер с глубиной сцены, которую читают
 * атмосфера и копия для объёмов; (3) передние объёмы со своей копией
 * глубины; (4) слои назад. Атмосфера следом тонирует всё как
 * в основном проходе.
 */
export class LensFrontPass extends Pass {
  public readonly depthCopy: DepthCopyPass
  public readonly restoreMaterial: DepthRestoreMaterial

  private sceneDepth: Texture | null = null
  private readonly resolution = new Vector2(1, 1)
  private readonly scaled = new DepthVolumeResolutionRenderer()

  public constructor(
    private readonly frontScene: Scene,
    private readonly sceneCamera: PerspectiveCamera,
    private readonly sorter: LensFrontSorter
  ) {
    super('LensFrontPass')
    this.needsSwap = false
    this.needsDepthTexture = true
    this.restoreMaterial = new DepthRestoreMaterial()
    this.fullscreenMaterial = this.restoreMaterial
    // BasicDepthPacking → FloatType-таргет, глубина в .r без упаковки (как у DepthVolumePass)
    this.depthCopy = new DepthCopyPass({ depthPacking: BasicDepthPacking })
  }

  public override setDepthTexture(depthTexture: Texture, depthPacking?: DepthPacking): void {
    this.sceneDepth = depthTexture
    this.restoreMaterial.depthBuffer = depthTexture
    this.depthCopy.setDepthTexture(depthTexture, depthPacking)
  }

  public override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: number): void {
    this.depthCopy.initialize(renderer, alpha, frameBufferType)
  }

  public override setSize(width: number, height: number): void {
    this.depthCopy.setSize(width, height)
    this.resolution.set(width, height)
  }

  public override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
    deltaTime?: number,
    stencilTest?: boolean
  ): void {
    try {
      const objects = this.sorter.frontObjects()
      const volumes = this.sorter.frontVolumes()
      if (volumes.length === 0) this.scaled.prepare(volumes, this.resolution)
      if (objects.length === 0 && volumes.length === 0) {
        return
      }

      const target = this.renderToScreen ? null : inputBuffer

      // Буфер с привязанной глубиной сцены (свопа не было) её уже несёт;
      // сэмплировать собственный аттачмент — feedback loop
      if (this.sceneDepth !== null && inputBuffer?.depthTexture !== this.sceneDepth) {
        renderer.setRenderTarget(target)
        renderer.render(this.scene, this.camera)
      }

      if (objects.length > 0) {
        const camera = this.sceneCamera
        const mask = camera.layers.mask
        const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate

        try {
          camera.layers.set(LENS_FRONT_LAYER)
          renderer.shadowMap.autoUpdate = false
          renderer.setRenderTarget(target)
          renderer.render(this.frontScene, camera)

          // Глубина сцены живёт в другом буфере композера: без этой записи
          // атмосфера туманила бы кольцо, а пыль не обрывалась бы на нём
          if (this.sorter.hasDepthWriters() && outputBuffer !== null && outputBuffer.depthTexture === this.sceneDepth) {
            const color = renderer.state.buffers.color
            camera.layers.set(LENS_FRONT_DEPTH_LAYER)
            try {
              color.setMask(false)
              color.setLocked(true)
              renderer.setRenderTarget(outputBuffer)
              renderer.render(this.frontScene, camera)
            } finally {
              color.setLocked(false)
              color.setMask(true)
            }
          }
        } finally {
          camera.layers.mask = mask
          renderer.shadowMap.autoUpdate = shadowMapAutoUpdate
        }
      }

      if (volumes.length > 0) {
        this.depthCopy.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)
        drawDepthVolumes(
          renderer,
          target,
          this.sceneCamera,
          orderFarToNear(volumes, this.sceneCamera),
          this.depthCopy.texture,
          this.resolution,
          this.scaled
        )
      }
    } finally {
      this.sorter.restore()
    }
  }

  public override dispose(): void {
    this.scaled.dispose()
    this.depthCopy.dispose()
    this.restoreMaterial.dispose()
    super.dispose()
  }
}
