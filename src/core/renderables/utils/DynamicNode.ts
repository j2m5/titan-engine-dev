import { Group } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { RenderableObject3D, ShouldRenderOrbitLine } from '@/core/renderables/types'
import { Actor } from '@/core/models/Actor'
import { OrbitLine } from '@/core/renderables/utils/OrbitLine'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { AU, SpaceScale } from '@/core/constants'
import { timeStore } from '@/ui/mobx/TimeStore'

/**
 * Этот объект представляет собой контейнер динамического объекта, который обновляет свою позицию в пространстве
 * на данный момент алгоритм расчета позиции основан на кеплеровской модели орбиты и траектория также расчитывается по этой модели
 * это накладывает ограничение на использование объекта только для тех сущностей, которые имеют орбитальные элементы
 * в дальнейшем если потребуется поддержка других типов движения и траекторий, то необходимо будет доработать функционал данного класса
 * например применить паттерн стратегия для расчета позиции и траектории
 */

/** Категории тел, к чьим мешам применяется ориентация (звезда, планета) */
const ORIENTED_CATEGORIES: Set<number> = new Set([3, 4])

class DynamicNode extends Group implements Acceptable<IObject3DVisitor>, ShouldRenderOrbitLine {
  public model: Actor
  public renderable: RenderableObject3D | null = null
  /** Экваториальная рамка: наклонена по полюсу тела, но не вращается — сюда цепляются кольца и атмосферы */
  public equatorialFrame: Group = new Group()
  declare orbit: OrbitLine

  private keplerianModel: KeplerianModel
  private orientationModel: OrientationModel

  public constructor(model: Actor) {
    super()
    this.model = model
    this.keplerianModel = new KeplerianModel(this.model)
    this.orientationModel = new OrientationModel(this.model)
    this.name = this.model.getAttribute('name')

    this.__setup()
  }

  __setup(): void {
    this.orbit = new OrbitLine(this.model)
    this.orbit.parent = this

    this.equatorialFrame.name = this.name + 'EquatorialFrame'
    this.equatorialFrame.quaternion.copy(this.orientationModel.getPoleQuaternion())
    this.add(this.equatorialFrame)
  }

  private get isOriented(): boolean {
    return ORIENTED_CATEGORIES.has(this.model.getAttribute('categoryId'))
  }

  public updateObject(delta?: number): void {
    const { position } = this.keplerianModel.getStateByEpoch(timeStore.epoch)
    this.position.copy(position).multiplyScalar(AU * SpaceScale)

    if (this.renderable && this.isOriented) {
      this.renderable.quaternion.copy(this.orientationModel.getQuaternion(timeStore.epoch))
    }
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitNode(this)
  }
}

export { DynamicNode }
