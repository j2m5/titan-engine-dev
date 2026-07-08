import { BufferGeometry, CubeTexture, Intersection, Mesh, Raycaster, Sphere, SphereGeometry, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { BlackHoleMaterial } from '@/core/renderables/BlackHole/BlackHoleMaterial'
import { threeJS } from '@/core/graphic/ThreeJS'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * Чёрная дыра (уровень L0): bounding-сфера зоны симуляции лензирования
 *
 * Геометрия — сфера радиусом simulationRadius; шейдер исполняется только
 * на покрытых ею пикселях. Меш НИКОГДА не вращается (в отличие от Planet/Star):
 * объектные направления должны совпадать с мировыми для прямого сэмплирования
 * фоновой кубмапы; наклон диска (axialTilt) уйдёт в uniform на этапе 3
 */
class BlackHole extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: BlackHoleMaterial

  public readonly parameters: BlackHoleParameters

  private static readonly _clickSphere: Sphere = new Sphere()
  private static readonly _clickPoint: Vector3 = new Vector3()

  private _epoch: number = 0

  public constructor(model: Actor) {
    super()
    this.model = model
    this.parameters = new BlackHoleParameters(model)

    this.__setup()
  }

  __setup(): void {
    // сфера — лишь проекционная оболочка для фрагментного шейдера,
    // сегментация влияет только на гладкость силуэта зоны
    this.geometry = new SphereGeometry(this.parameters.simulationRadiusUnits, 64, 32)
    this.material = new BlackHoleMaterial(this.parameters)

    this.name = this.model.getAttribute('name') + 'BlackHole'
    this.userData.type = 'blackHole'
    // клик-таргет — сфера зоны симуляции, не горизонт (спецификация §9)
    this.userData.clickable = true

    // обновление uniforms — строго в onBeforeRender, а не в updateObject:
    // three вызывает его в момент рендера, когда матрицы камеры и меша
    // актуальны для ТЕКУЩЕГО кадра. Обновление через sceneManager.update
    // (после рендера) даёт покадровый рассинхрон, который проявляется
    // паразитным параллаксом фона при трансляции камеры
    this.onBeforeRender = (): void => {
      this.material.update(this, threeJS.camera, threeJS.scene.background as CubeTexture | null, this._epoch)
    }
  }

  /**
   * Кастомный рейкаст: кликабелен только видимый образ дыры (clickRadiusUnits),
   * а не вся bounding-сфера зоны симуляции. Геометрия меша в рейкасте
   * не участвует — пересечение считается аналитически
   */
  public raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    BlackHole._clickSphere.center.setFromMatrixPosition(this.matrixWorld)
    BlackHole._clickSphere.radius = this.parameters.clickRadiusUnits

    const point: Vector3 | null = raycaster.ray.intersectSphere(BlackHole._clickSphere, BlackHole._clickPoint)

    if (point) {
      const distance: number = raycaster.ray.origin.distanceTo(point)

      if (distance >= raycaster.near && distance <= raycaster.far) {
        intersects.push({ distance, point: point.clone(), object: this })
      }
    }
  }

  public updateObject(ctx: UpdateContext): void {
    // per-frame обновление материала живёт в onBeforeRender; сюда кэшируем
    // актуальную эпоху кадра (updateObject вызывается до рендера)
    this._epoch = ctx.epoch
  }
}

export { BlackHole }
