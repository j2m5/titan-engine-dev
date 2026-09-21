import type { Camera, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { BufferGeometry, Mesh, SphereGeometry, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'
import { UpdateContext } from '@/core/UpdateContext'
import { GiantStarMaterial } from '@/core/renderables/GiantStar/GiantStarMaterial'
import {
  giantStarParameters,
  GiantStarParameters,
  GIANT_STAR_TIME_SCALE
} from '@/core/renderables/GiantStar/GiantStarParameters'
import { frameCoverage, proximityExposure } from '@/core/renderables/WhiteDwarf/proximityExposure'

/**
 * Фотосфера звезды-гиганта. Оболочка-атмосфера — дочерний меш (GiantStarShell),
 * его добавляет фабрика: тело владеет только собой.
 */
class GiantStar extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: GiantStarMaterial

  public readonly parameters: GiantStarParameters
  /** Радиус фотосферы в юнитах сцены */
  public readonly radius: number

  private readonly cameraWorld: Vector3 = new Vector3()
  private readonly bodyWorld: Vector3 = new Vector3()

  public constructor(model: Actor) {
    super()
    this.model = model
    this.radius = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)
    this.parameters = giantStarParameters(model)

    this.geometry = new SphereGeometry(this.radius, 256, 256)
    this.material = new GiantStarMaterial(this.parameters)

    this.name = this.model.getAttribute('name', '') + 'GiantStar'
    this.userData.type = 'giantStar'
    this.userData.clickable = true

    const floor: number = config('giantStar.proximityExposureFloor')
    const start: number = config('giantStar.proximityExposureStart')
    const end: number = config('giantStar.proximityExposureEnd')

    // onBeforeRender, а не updateObject: там matrixWorld отстаёт на кадр, а
    // three зовёт этот хук с актуальными матрицами и камерой текущего прохода
    this.onBeforeRender = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
      const perspective = camera as PerspectiveCamera

      if (!perspective.isPerspectiveCamera) return

      camera.getWorldPosition(this.cameraWorld)
      this.bodyWorld.setFromMatrixPosition(this.matrixWorld)

      const coverage: number = frameCoverage(
        this.radius,
        this.bodyWorld.distanceTo(this.cameraWorld),
        perspective.fov
      )

      this.material.uniforms.uProximityExposure.value = proximityExposure(coverage, floor, start, end)
    }
  }

  public updateObject(ctx: UpdateContext): void {
    this.material.uniforms.time.value = ctx.elapsed * GIANT_STAR_TIME_SCALE
  }

  public dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export { GiantStar }
