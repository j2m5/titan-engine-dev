import { Group } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { ShouldRenderOrbitLine } from '@/core/new-renderables/types'
import { Actor } from '@/core/models/Actor'
import { OrbitLine } from '@/core/new-renderables/utils/OrbitLine'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { AU, SpaceScale } from '@/core/constants'
import { timeStore } from '@/ui/mobx/TimeStore'

/**
 * Этот объект представляет из себя контейнер динамического объекта, который обновляет свою позицию в пространстве
 * на данный момент алгоритм расчета позиции основан на кеплеровской модели орбиты и траектория также расчитывается по этой модели
 * это накладывает ограничение на использование объекта только для тех сущностей, которые имеют орбитальные элементы
 * в дальнейшем если потребуется поддержка других типов движения и траекторий, то необходимо будет доработать функционал данного класса
 * например применить паттерн стратегия для расчета позиции и траектории
 */

class DynamicNode extends Group implements Acceptable<IObject3DVisitor>, ShouldRenderOrbitLine {
  public model: Actor
  declare orbit: OrbitLine

  private keplerianModel: KeplerianModel

  public constructor(model: Actor) {
    super()
    this.model = model
    this.keplerianModel = new KeplerianModel(timeStore.epoch, this.model)
    this.name = this.model.getAttribute('name')

    this.__setup()
  }

  __setup(): void {
    this.orbit = new OrbitLine(this.model)
    this.orbit.parent = this
  }

  public updateObject(delta?: number): void {
    const { position } = this.keplerianModel.getStateByEpoch(timeStore.epoch)
    this.position.copy(position).multiplyScalar(AU * SpaceScale)
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitNode(this)
  }
}

export { DynamicNode }
