import { Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { StaticNode } from '@/core/renderables/utils/StaticNode'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { AU, SpaceScale } from '@/core/constants'
import { UpdateContext } from '@/core/UpdateContext'

/** Точки Лагранжа L4/L5 — равносторонний треугольник со звездой и планетой: ±60° по орбите */
const LAGRANGE_ANGLE = Math.PI / 3

/**
 * Узел актора с СОБСТВЕННОЙ, но статической позицией — третий режим рядом
 * с двумя существующими.
 *
 * DynamicNode не годится: он перетирает position из KeplerianModel на каждом
 * кадре (смещение из placement пропало бы) и заводит OrbitLine, которую
 * SceneManager подхватит как вырожденную орбитальную линию.
 *
 * Голый StaticNode не годится: его accept уходит в visitComponent, а тот
 * кладёт объект в equatorialFrame родителя — так монтируются кольца и
 * атмосферы, у которых своей позиции нет вообще.
 *
 * Размещение `lagrange: 4 | 5` — позиция не статическая, а точка Лагранжа
 * орбиты РОДИТЕЛЯ (планеты): узел планеты едет по Кеплеру, но на угол орбиты
 * не поворачивается, поэтому смещение к L4/L5 считается в кадре по положению
 * и скорости планеты. Узел — ребёнок узла планеты, позиция в её кадре.
 */
class PlacedNode extends StaticNode {
  private readonly lagrange: 4 | 5 | null
  private readonly parentOrbit: KeplerianModel | null
  private readonly _normal = new Vector3()
  private readonly _point = new Vector3()

  public constructor(model: Actor) {
    super(model)

    const placement = model.placement
    const lagrange = placement?.getAttribute('lagrange') ?? null
    this.lagrange = lagrange === 4 || lagrange === 5 ? lagrange : null
    this.parentOrbit = this.lagrange !== null && model.parent?.orbit ? new KeplerianModel(model.parent) : null

    if (placement && this.lagrange === null) {
      this.position.set(
        fromAstronomicalUnits(placement.getAttribute('x', 0)),
        fromAstronomicalUnits(placement.getAttribute('y', 0)),
        fromAstronomicalUnits(placement.getAttribute('z', 0))
      )
    }

    // Строка rotation задаёт наклон плоскости узла (узел + наклон), без
    // суточного вращения: пояс лежит в наклонённой плоскости, но не крутится
    // как тело. Без строки — плоскость системы
    if (model.rotation) {
      this.quaternion.copy(new OrientationModel(model).getPoleQuaternion())
    }
  }

  public updateObject(ctx: UpdateContext): void {
    if (this.parentOrbit === null) return

    const { position, velocity } = this.parentOrbit.getStateByEpoch(ctx.epoch)
    if (position.lengthSq() === 0 || velocity.lengthSq() === 0) return

    // Нормаль орбиты — p × v; поворот p вокруг неё на +60° ведёт к скорости
    // (L4 впереди планеты), на −60° — назад (L5). Смещение — от планеты
    this._normal.copy(position).cross(velocity).normalize()
    this._point.copy(position).applyAxisAngle(this._normal, this.lagrange === 4 ? LAGRANGE_ANGLE : -LAGRANGE_ANGLE)
    this.position.copy(this._point.sub(position)).multiplyScalar(AU * SpaceScale)
  }

  public override accept(visitor: IObject3DVisitor): void {
    visitor.visitNode(this)
  }
}

export { PlacedNode }
