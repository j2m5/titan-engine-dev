import { Entity } from '@/core/framework/Entity'
import { Actor } from '@/core/models/Actor'
import { Object3D, Vector3 } from 'three'
import { UsesMark } from '@/core/framework/components/UsesMark'
import { MarkerManager, MarkerOptions } from '@/core/services/MarkerManager'
import { OrbitLine } from '@/core/renderables/utils/OrbitLine'
import { Placeable } from '@/core/framework/components/Placeable'
import { Movable } from '@/core/framework/components/Movable'
import { inject, injectable } from 'inversify'
import { ScenarioLoader } from '@/core/services/ScenarioLoader'
import { Engine } from '@/core/Engine'
import DIServices from '@/core/framework/DI/DIServices'

@injectable()
class SceneManager {
  public constructor(
    @inject(DIServices.ScenarioLoader) private scenarioLoader: ScenarioLoader,
    @inject(DIServices.Engine) private engine: Engine,
    @inject(DIServices.MarkerManager) private markerManager: MarkerManager
  ) {}

  public build(): void {
    if (this.scenarioLoader?.map) {
      // если не в главном меню строим граф сцены
      this.engine.entities.forEach((value: Entity, index: number, array: Entity[]): void => {
        // пробегаем по массиву зарегистрированных сущностей
        if (value.hasComponent(Actor) && !value.getComponent(Actor).parent) {
          // если у сущности есть модель данных и отсутствует родитель
          // добавляем привязанный к сущности 3D-объект напрямую в сцену из стейта
          this.scenarioLoader?.scene.add(value.getComponent(Object3D))
        } else if (value.hasComponent(Actor) && value.getComponent(Actor).parent) {
          // если у сущности есть модель данных и есть родитель
          // ищем его и добавляем привязанный к сущности 3D-объект в контейнер 3D-объекта родителя
          const parent: Entity | undefined = array.find(
            (el: Entity): boolean => el.id === value.getComponent(Actor).parent?.getAttribute('id')
          )

          if (parent) {
            parent.getComponent(Object3D).add(value.getComponent(Object3D))

            if (value.hasComponent(Placeable) && value.hasComponent(Movable)) {
              parent.getComponent(Object3D).add(new OrbitLine(value.getComponent(Actor)).build())
            }
          }
        }

        if (value.hasComponent(Actor) && value.hasComponent(UsesMark)) {
          // если сущность имеет модель данных и помечена как имеющая маркер
          // пробуем найти координату или возвращаем нулевой вектор если координата не найдена
          const placement: Vector3 = value.getComponent(Actor).placement
            ? new Vector3(
                value.getComponent(Actor).placement?.getAttribute('x', 0),
                value.getComponent(Actor).placement?.getAttribute('z', 0),
                value.getComponent(Actor).placement?.getAttribute('y', 0)
              )
            : new Vector3()

          // создаем маркер и добавляем в указанную координату
          const mark: MarkerOptions = {
            entity: value,
            label: value.getComponent(Actor).getAttribute('name'),
            shape: value.getComponent(UsesMark).shape,
            offset: placement
          }

          this.markerManager.add(mark)
        }
      })
    } else {
      throw new Error('Application state has not defined')
    }
  }
}

export { SceneManager }
