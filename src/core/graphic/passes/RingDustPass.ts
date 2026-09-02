import { BasicDepthPacking, type Object3D, type PerspectiveCamera, type Texture, type WebGLRenderer, type WebGLRenderTarget, Vector2 } from 'three'
import { DepthCopyPass, Pass } from 'postprocessing'

/** Тип упаковки глубины библиотека объявляет, но не экспортирует — берём из сигнатуры Pass */
type DepthPacking = Parameters<Pass['setDepthTexture']>[1]
import type { RingDustRegistry } from '@/core/services/RingDustRegistry'
import { RING_DUST_LAYER, type RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'

/**
 * RingDustPass — гало пылевой дымки колец поверх отрендеренной сцены.
 *
 * Зачем отдельный пасс. Гало — реймарч на прокси-сфере, один фрагмент несёт
 * интеграл вдоль ВСЕГО луча. Аппаратный тест глубины бинарен: он либо срезал
 * гало целиком над камнями и планетой (глубина от дальней стенки прокси), либо
 * пропускал целиком вместе с пылью ЗА ними (глубина от точки входа) — планета
 * и камни просвечивали. Честное перекрытие — обрыв марша на глубине сцены, а
 * читать глубину можно только после того, как сцена дорисована.
 *
 * Почему копия глубины. Сцена лежит в inputBuffer, к нему же привязана
 * depth-текстура композера. Рисовать в inputBuffer и сэмплировать его
 * аттачмент — feedback loop, WebGL такой draw отвергает. Поэтому глубина
 * сначала копируется во float-таргет (DepthCopyPass), и гало читает копию.
 *
 * Гало рисуется В inputBuffer (needsSwap = false): аддитивный блендинг поверх
 * готового кадра, без своей глубины (depthTest/depthWrite OFF у материала).
 * Атмосфера идёт следом и тонирует пыль так же, как тонировала раньше.
 *
 * Объёмы живут в графе сцены (матрицы считает основной проход) на слое
 * RING_DUST_LAYER, который камера обычно не видит; пасс включает слой только
 * на время своего рендера и рендерит каждый объём как корень — обход графа
 * целой сцены второй раз за кадр не нужен.
 */
export class RingDustPass extends Pass {
  /** Копия глубины сцены во float-таргет; открыта под тесты */
  public readonly depthCopy: DepthCopyPass

  private readonly sceneCamera: PerspectiveCamera
  private readonly registry: RingDustRegistry
  private readonly resolution = new Vector2(1, 1)
  private readonly visibleVolumes: RingDustVolume[] = []

  public constructor(camera: PerspectiveCamera, registry: RingDustRegistry) {
    super('RingDustPass')
    this.sceneCamera = camera
    this.registry = registry
    this.needsSwap = false
    this.needsDepthTexture = true
    // BasicDepthPacking → FloatType-таргет, глубина в .r без упаковки
    this.depthCopy = new DepthCopyPass({ depthPacking: BasicDepthPacking })
  }

  public override setDepthTexture(depthTexture: Texture, depthPacking?: DepthPacking): void {
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
    const volumes = this.collectVisible()
    if (volumes.length === 0) return

    this.depthCopy.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)

    const camera = this.sceneCamera
    const mask = camera.layers.mask
    const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate
    const logFarFactor = Math.log2(camera.far + 1)

    camera.layers.set(RING_DUST_LAYER)
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer)

    for (const volume of volumes) {
      volume.bindSceneDepth(this.depthCopy.texture, this.resolution, logFarFactor)
      renderer.render(volume, camera)
    }

    camera.layers.mask = mask
    renderer.shadowMap.autoUpdate = shadowMapAutoUpdate
  }

  public override dispose(): void {
    this.depthCopy.dispose()
    super.dispose()
  }

  /** Объёмы, у которых видна вся цепочка предков: рендер корня предков не проверяет */
  private collectVisible(): RingDustVolume[] {
    const out = this.visibleVolumes
    out.length = 0
    for (const volume of this.registry.volumes()) {
      if (isVisibleInTree(volume)) out.push(volume)
    }
    return out
  }
}

function isVisibleInTree(object: Object3D): boolean {
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}
