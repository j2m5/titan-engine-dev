import { BufferGeometry, Camera, CubeTexture, Matrix4, Mesh, Scene, SphereGeometry, Vector3, type WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { UpdateContext } from '@/core/UpdateContext'
import { config } from '@/core/framework/config'
import { BrownDwarfCloudBaker } from '@/core/renderables/BrownDwarf/BrownDwarfCloudBaker'
import { BrownDwarfMaterial } from '@/core/renderables/BrownDwarf/BrownDwarfMaterial'
import { brownDwarfParameters, BrownDwarfParameters } from '@/core/renderables/BrownDwarf/BrownDwarfParameters'

/**
 * Диск коричневого карлика.
 *
 * Облачное поле печётся один раз в конструкторе и дальше не трогается: форма
 * статична и прибита к телу. Время идёт только в дыхание яркости.
 *
 * Владеет запекателем — освобождение кубмапы идёт через его dispose.
 */
class BrownDwarf extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: BrownDwarfMaterial

  private readonly radius: number
  private readonly baker: BrownDwarfCloudBaker
  /** Переиспользуемые буферы перевода камеры в объектные координаты */
  private readonly cameraWorld: Vector3 = new Vector3()
  private readonly inverseModel: Matrix4 = new Matrix4()

  public constructor(model: Actor, renderer: WebGLRenderer) {
    super()
    this.model = model
    this.radius = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)

    const params: BrownDwarfParameters = brownDwarfParameters(model)

    this.baker = new BrownDwarfCloudBaker(renderer, {
      seed: params.seed,
      bandCount: params.bandCount,
      jetStrength: params.jetStrength,
      turbulence: params.turbulence,
      size: config('brownDwarf.cubeSize'),
      steps: config('brownDwarf.advectionSteps'),
      injection: config('brownDwarf.noiseInjection')
    })

    const clouds: CubeTexture = this.baker.bake()

    this.geometry = new SphereGeometry(this.radius, 256, 256)
    this.material = new BrownDwarfMaterial(params, clouds)

    this.name = this.model.getAttribute('name', '') + 'BrownDwarf'
    this.userData.type = 'brownDwarf'
    this.userData.clickable = true

    // Камера в объектных координатах обновляется строго в onBeforeRender, а не
    // в updateObject: SceneManager.update отрабатывает ДО того, как
    // WebGLRenderer.render вызовет scene.updateMatrixWorld(), поэтому там
    // matrixWorld тела отстаёт на кадр, и рисунок запаздывал бы за вращением.
    // three же зовёт onBeforeRender в момент рендера, когда матрицы актуальны.
    //
    // Камера берётся из аргумента, а НЕ из ctx.camera: three передаёт сюда
    // камеру текущего прохода, что важно для проходов вне главного цикла
    // (Postprocessing.renderToScreenshot со своей камерой). Прецедент —
    // BlackHole.onBeforeRender.
    this.onBeforeRender = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
      camera.getWorldPosition(this.cameraWorld)

      this.material.uniforms.uCameraObject.value
        .copy(this.cameraWorld)
        .applyMatrix4(this.inverseModel.copy(this.matrixWorld).invert())
    }
  }

  /** Запекатель для теста освобождения ресурсов */
  public get bakerForTest(): BrownDwarfCloudBaker {
    return this.baker
  }

  public updateObject(ctx: UpdateContext): void {
    // Время идёт в дыхание яркости и НИКУДА больше: форма от него не зависит.
    // Позиция камеры живёт в onBeforeRender — см. причину в конструкторе
    this.material.uniforms.time.value = ctx.elapsed
  }

  public dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.baker.dispose()
  }
}

export { BrownDwarf }
