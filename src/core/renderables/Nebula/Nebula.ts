import {
  BoxGeometry,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  Scene,
  Texture,
  Vector2,
  WebGLRenderTarget
} from 'three'
import { NebulaMaterial } from '@/core/renderables/Nebula/NebulaMaterial'
import { NebulaUpscaleMaterial } from '@/core/renderables/Nebula/NebulaUpscaleMaterial'
import { NebulaVolumeGenerator } from '@/core/renderables/Nebula/NebulaVolumeGenerator'
import { NebulaParameters, NebulaParametersInit } from '@/core/renderables/Nebula/NebulaParameters'
import { threeJS } from '@/core/graphic/ThreeJS'

class Nebula extends Mesh {
  declare public geometry: BufferGeometry
  declare public material: NebulaUpscaleMaterial

  public readonly parameters: NebulaParameters

  // ── Приватный off-screen проход ──
  private readonly _marchScene: Scene
  private readonly _marchMesh: Mesh
  private readonly _marchMaterial: NebulaMaterial
  private _rt: WebGLRenderTarget
  private readonly _rtSize = new Vector2()
  private readonly _drawSize = new Vector2()

  /** Доля разрешения для half-RT (0.5 = половина по каждой оси = ¼ фрагментов) */
  private readonly _resolutionScale: number

  // ── Общая 3D-текстура облака на все туманности (Путь 2) ──
  // Одна текстура переиспользуется всеми кусками; разнообразие достигается
  // трансформом/сдвигом texcoord, а не отдельными текстурами на кусок.
  private static sharedGenerator: NebulaVolumeGenerator | null = null
  private static sharedCloudTex: Texture | null = null

  public constructor(init: NebulaParametersInit = {}) {
    super()
    this.parameters = new NebulaParameters(init)
    this._resolutionScale = init.resolutionScale ?? 0.25

    // геометрия куба — общая форма для видимого меша и для марш-меша
    const side = this.parameters.radius * 2
    this.geometry = new BoxGeometry(side, side, side)

    // ── марш-материал и его меш живут в приватной сцене ──
    this._marchMaterial = new NebulaMaterial(this.parameters)
    this._marchMesh = new Mesh(this.geometry, this._marchMaterial)
    this._marchMesh.frustumCulled = false
    this._marchScene = new Scene()
    this._marchScene.add(this._marchMesh)
    this._marchMesh.position.copy(this.parameters.center)

    // ── 3D-текстура облака (Путь 2): генерим один раз, переиспользуем ──
    // Биндим именно на МАРШ-материал (_marchMaterial делает рейчмарч и
    // сэмплит текстуру). this.material — это upscale, текстуру не использует.
    if (this.parameters.useVolumeTexture) {
      if (!Nebula.sharedCloudTex) {
        if (!Nebula.sharedGenerator) {
          Nebula.sharedGenerator = new NebulaVolumeGenerator(threeJS.renderer)
        }
        Nebula.sharedCloudTex = Nebula.sharedGenerator.generate(this.parameters, this.parameters.texResolution)
      }
      this._marchMaterial.setCloudTexture(Nebula.sharedCloudTex)
    }

    // ── half-RT ──
    threeJS.renderer.getDrawingBufferSize(this._drawSize)
    this._rtSize.set(
      Math.max(1, Math.floor(this._drawSize.x * this._resolutionScale)),
      Math.max(1, Math.floor(this._drawSize.y * this._resolutionScale))
    )
    this._rt = this.__createRT(this._rtSize.x, this._rtSize.y)

    // ── видимый меш: upscale-материал (full-res разрешение для пересчёта UV) ──
    this.material = new NebulaUpscaleMaterial(this._rt.texture, this._drawSize)

    this.position.copy(this.parameters.center)

    this.name = 'Nebula'
    this.userData.type = 'nebula'
    this.frustumCulled = false
  }

  private __createRT(w: number, h: number): WebGLRenderTarget {
    const rt = new WebGLRenderTarget(w, h, {
      type: HalfFloatType, // HDR-эмиссия (> 1) для bloom, как основной композер
      depthBuffer: false, // марш-кубу depth-буфер не нужен
      stencilBuffer: false,
      minFilter: LinearFilter, // бесплатный bilinear-апскейл half→full
      magFilter: LinearFilter
    })
    rt.texture.generateMipmaps = false

    return rt
  }

  /** Пересоздать half-RT при изменении размера буфера (ресайз окна, скриншот) */
  private __resizeIfNeeded(): void {
    threeJS.renderer.getDrawingBufferSize(this._drawSize)

    const w = Math.max(1, Math.floor(this._drawSize.x * this._resolutionScale))
    const h = Math.max(1, Math.floor(this._drawSize.y * this._resolutionScale))

    if (w !== this._rtSize.x || h !== this._rtSize.y) {
      this._rtSize.set(w, h)
      this._rt.dispose()
      this._rt = this.__createRT(w, h)
      this.material.setTexture(this._rt.texture)
    }

    // upscale-материалу всегда нужно АКТУАЛЬНОЕ полное разрешение для UV
    this.material.setResolution(this._drawSize.x, this._drawSize.y)
  }

  /**
   * Вызывается каждый кадр из SceneManager.update (до основного прохода).
   * Рендерит марш в half-RT текущей камерой.
   */
  public updateObject(_delta?: number): void {
    this.__resizeIfNeeded()

    // марш-меш повторяет мировой transform видимого куба, чтобы лучи в half-RT
    // совпадали с проекцией видимого меша. updateMatrixWorld видимого меша
    // уже выполнен движком до traverse.
    this._marchMesh.matrix.copy(this.matrixWorld)
    this._marchMesh.matrixWorld.copy(this.matrixWorld)
    this._marchMesh.matrixWorldNeedsUpdate = false

    // обновить uniforms марша (камера → локаль куба) — та же логика, что раньше
    this._marchMaterial.update(this._marchMesh, threeJS.camera)

    const renderer = threeJS.renderer
    const prevRT = renderer.getRenderTarget()
    const prevAutoClear = renderer.autoClear

    renderer.setRenderTarget(this._rt)
    renderer.autoClear = true
    renderer.setClearColor(0x000000, 0) // прозрачный clear
    renderer.clear(true, false, false)
    renderer.render(this._marchScene, threeJS.camera)

    renderer.setRenderTarget(prevRT)
    renderer.autoClear = prevAutoClear
  }
}

export { Nebula }
