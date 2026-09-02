import { BasicDepthPacking, type Object3D, type PerspectiveCamera, type Texture, type WebGLRenderer, type WebGLRenderTarget, Vector2, Vector3 } from 'three'
import { DepthCopyPass, Pass } from 'postprocessing'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { DEPTH_VOLUME_LAYER, type DepthVolume } from '@/core/graphic/passes/DepthVolume'

/** Тип упаковки глубины библиотека объявляет, но не экспортирует — берём из сигнатуры Pass */
type DepthPacking = Parameters<Pass['setDepthTexture']>[1]

/**
 * DepthVolumePass — объёмные эффекты (пыль колец, туманности) поверх
 * отрендеренной сцены с обрывом марша по её глубине.
 *
 * Зачем отдельный пасс. Объём — реймарч на прокси, один фрагмент несёт
 * интеграл вдоль ВСЕГО луча. Аппаратный тест глубины бинарен: он либо срезал
 * объём целиком перед поверхностями (глубина от дальней стенки прокси), либо
 * пропускал целиком вместе с частью ЗА ними (глубина от точки входа) — планета
 * и камни просвечивали сквозь пыль, туманность давала жёсткие вырезы. Честное
 * перекрытие — обрыв марша на глубине сцены, а читать глубину можно только
 * после того, как сцена дорисована.
 *
 * Почему копия глубины. Сцена лежит в inputBuffer, к нему же привязана
 * depth-текстура композера. Рисовать в inputBuffer и сэмплировать его
 * аттачмент — feedback loop, WebGL такой draw отвергает. Поэтому глубина
 * сначала копируется во float-таргет (DepthCopyPass), и объёмы читают копию.
 *
 * Объёмы рисуются В inputBuffer (needsSwap = false) поверх готового кадра, без
 * своей глубины (depthTest/depthWrite OFF у материалов), от дальнего к
 * ближнему по расстоянию до камеры: ближний ложится поверх дальнего (пыль
 * кольца поверх туманности за ним). Атмосфера идёт следом и тонирует их так же,
 * как тонировала бы в основном проходе.
 *
 * Объёмы живут в графе сцены (матрицы считает основной проход) на слое
 * DEPTH_VOLUME_LAYER, который камера обычно не видит; пасс включает слой только
 * на время своего рендера и рендерит каждый объём как корень — обход графа
 * целой сцены второй раз за кадр не нужен. Перед рендером объёму привязывается
 * копия глубины, после — отвязывается: рендер объёма вне пасса (запекание
 * импостора) идёт без обрезки.
 */
export class DepthVolumePass extends Pass {
  /** Копия глубины сцены во float-таргет; открыта под тесты */
  public readonly depthCopy: DepthCopyPass

  private readonly sceneCamera: PerspectiveCamera
  private readonly registry: DepthVolumeRegistry
  private readonly resolution = new Vector2(1, 1)
  private readonly visibleVolumes: DepthVolume[] = []
  private readonly cameraWorld = new Vector3()
  private readonly volumeWorld = new Vector3()
  private readonly distanceSq = new WeakMap<DepthVolume, number>()

  public constructor(camera: PerspectiveCamera, registry: DepthVolumeRegistry) {
    super('DepthVolumePass')
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
    const volumes = this.collectVisibleFarToNear()
    if (volumes.length === 0) return

    this.depthCopy.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)

    const camera = this.sceneCamera
    const mask = camera.layers.mask
    const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate
    const logFarFactor = Math.log2(camera.far + 1)

    camera.layers.set(DEPTH_VOLUME_LAYER)
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer)

    for (const volume of volumes) {
      volume.bindSceneDepth(this.depthCopy.texture, this.resolution, logFarFactor)
      renderer.render(volume, camera)
      volume.unbindSceneDepth()
    }

    camera.layers.mask = mask
    renderer.shadowMap.autoUpdate = shadowMapAutoUpdate
  }

  public override dispose(): void {
    this.depthCopy.dispose()
    super.dispose()
  }

  /**
   * Объёмы, у которых видна вся цепочка предков (рендер корня предков не
   * проверяет), от дальнего к ближнему по расстоянию центра до камеры.
   */
  private collectVisibleFarToNear(): DepthVolume[] {
    const out = this.visibleVolumes
    out.length = 0
    this.sceneCamera.getWorldPosition(this.cameraWorld)
    for (const volume of this.registry.volumes()) {
      if (!isVisibleInTree(volume)) continue
      volume.getWorldPosition(this.volumeWorld)
      this.distanceSq.set(volume, this.volumeWorld.distanceToSquared(this.cameraWorld))
      out.push(volume)
    }
    out.sort((a, b) => this.distanceSq.get(b)! - this.distanceSq.get(a)!)
    return out
  }
}

function isVisibleInTree(object: Object3D): boolean {
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}
