import { BasicDepthPacking, type Object3D, type PerspectiveCamera, type Texture, type WebGLRenderer, type WebGLRenderTarget, Vector2, Vector3 } from 'three'
import { DepthCopyPass, Pass } from 'postprocessing'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { DEPTH_VOLUME_LAYER, type DepthVolume } from '@/core/graphic/passes/DepthVolume'

/** Тип упаковки глубины библиотека объявляет, но не экспортирует — берём из сигнатуры Pass */
type DepthPacking = Parameters<Pass['setDepthTexture']>[1]

/** Фильтр передних объёмов (LensFrontSorter подходит структурно) */
export interface FrontVolumeFilter {
  isFrontVolume(volume: DepthVolume): boolean
}

/**
 * Объёмы от дальнего к ближнему по дальней кромке: расстояние центра до камеры
 * + радиус описанной сферы (boundingRadius в мировом масштабе). Объёмы с общим
 * центром (кокон туманности и пояс вокруг одной звезды) так упорядочиваются по
 * охвату, а не по порядку регистрации — блендинг «поверх» зависит от порядка.
 */
export function orderFarToNear(volumes: readonly DepthVolume[], camera: Object3D): DepthVolume[] {
  const cameraWorld = camera.getWorldPosition(new Vector3())
  const position = new Vector3()
  const scale = new Vector3()
  const farExtent = new Map<DepthVolume, number>()
  for (const volume of volumes) {
    volume.getWorldPosition(position)
    volume.getWorldScale(scale)
    const worldRadius = (volume.boundingRadius ?? 0) * Math.max(scale.x, scale.y, scale.z)
    farExtent.set(volume, position.distanceTo(cameraWorld) + worldRadius)
  }
  return [...volumes].sort((a, b) => farExtent.get(b)! - farExtent.get(a)!)
}

/**
 * Объёмы в target камерой на DEPTH_VOLUME_LAYER: каждому на время рендера
 * привязана копия глубины сцены. Маска камеры и автообновление теней
 * возвращаются
 */
export function drawDepthVolumes(
  renderer: WebGLRenderer,
  target: WebGLRenderTarget | null,
  camera: PerspectiveCamera,
  volumes: readonly DepthVolume[],
  sceneDepth: Texture,
  resolution: Vector2
): void {
  const mask = camera.layers.mask
  const shadowMapAutoUpdate = renderer.shadowMap.autoUpdate
  const logFarFactor = Math.log2(camera.far + 1)

  camera.layers.set(DEPTH_VOLUME_LAYER)
  renderer.shadowMap.autoUpdate = false
  renderer.setRenderTarget(target)

  for (const volume of volumes) {
    volume.bindSceneDepth(sceneDepth, resolution, logFarFactor)
    renderer.render(volume, camera)
    volume.unbindSceneDepth()
  }

  camera.layers.mask = mask
  renderer.shadowMap.autoUpdate = shadowMapAutoUpdate
}

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
 *
 * Объёмы перед активной чёрной дырой пропускаются — их рисует LensFrontPass
 * поверх лензированного кадра.
 */
export class DepthVolumePass extends Pass {
  /** Копия глубины сцены во float-таргет; открыта под тесты */
  public readonly depthCopy: DepthCopyPass

  private readonly sceneCamera: PerspectiveCamera
  private readonly registry: DepthVolumeRegistry
  private readonly front: FrontVolumeFilter | null
  private readonly resolution = new Vector2(1, 1)

  public constructor(camera: PerspectiveCamera, registry: DepthVolumeRegistry, front?: FrontVolumeFilter) {
    super('DepthVolumePass')
    this.sceneCamera = camera
    this.registry = registry
    this.front = front ?? null
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
    // Передние объёмы (перед активной линзой) рисует LensFrontPass после линз
    const volumes = orderFarToNear(
      this.registry.volumes().filter((v) => isVisibleInTree(v) && !(this.front?.isFrontVolume(v) ?? false)),
      this.sceneCamera
    )
    if (volumes.length === 0) return

    this.depthCopy.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest)
    drawDepthVolumes(
      renderer,
      this.renderToScreen ? null : inputBuffer,
      this.sceneCamera,
      volumes,
      this.depthCopy.texture,
      this.resolution
    )
  }

  public override dispose(): void {
    this.depthCopy.dispose()
    super.dispose()
  }
}

export function isVisibleInTree(object: Object3D): boolean {
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}
