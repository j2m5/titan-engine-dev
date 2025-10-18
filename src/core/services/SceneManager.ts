import { Application } from '@/Application'
import { ICommand } from '@/core/commands/ICommand'
import { Entity } from '@/core/framework/Entity'
import { Actor } from '@/core/models/Actor'
import { Object3D, Vector3 } from 'three'
import { UsesMark } from '@/core/framework/components/UsesMark'
import { MarkerOptions } from '@/core/services/MarkerManager'
import { TransitionToStarSystemCommand } from '@/core/commands/TransitionToStarSystemCommand'
import { TransitionReceiver } from '@/core/commands/receivers/TransitionReceiver'
import { OrbitLine } from '@/core/renderables/utils/OrbitLine'
import { Placeable } from '@/core/framework/components/Placeable'
import { Movable } from '@/core/framework/components/Movable'
import { injectable } from 'inversify'

@injectable()
class SceneManager {
  private context!: Application
  private command!: ICommand

  public setContext(context: Application): void {
    this.context = context
  }

  private setCommand(command: ICommand): void {
    this.command = command
  }

  public build(): void {
    if (!this.context) throw new Error('Context is not set')
    if (this.context.state) {
      // если не в главном меню строим граф сцены
      this.context.engine.entities.forEach((value: Entity, index: number, array: Entity[]): void => {
        // пробегаем по массиву зарегистрированных сущностей
        if (value.hasComponent(Actor) && !value.getComponent(Actor).parent) {
          // если у сущности есть модель данных и отсутствует родитель
          // добавляем привязанный к сущности 3D-объект напрямую в сцену из стейта
          this.context.state?.scene.add(value.getComponent(Object3D))
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

          // если находимся на сцене галактики добавляем к маркерам обработчик клика
          if (this.context.state?.uuid === 'galaxy') {
            mark.onClick = (): void => {
              this.setCommand(new TransitionToStarSystemCommand(new TransitionReceiver(), this.context, value))
              this.command.execute()
            }
          }

          this.context.markerManager.add(mark)
        }
      })
    } else {
      throw new Error('Application state has not defined')
    }
  }
}

export { SceneManager }
