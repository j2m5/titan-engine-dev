import { Actor } from '@/core/models/Actor'
import { StaticNode } from '@/core/renderables/utils/StaticNode'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'

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
 */
class PlacedNode extends StaticNode {
  public constructor(model: Actor) {
    super(model)

    const placement = model.placement

    if (placement) {
      this.position.set(
        fromAstronomicalUnits(placement.getAttribute('x', 0)),
        fromAstronomicalUnits(placement.getAttribute('y', 0)),
        fromAstronomicalUnits(placement.getAttribute('z', 0))
      )
    }
  }

  public override accept(visitor: IObject3DVisitor): void {
    visitor.visitNode(this)
  }
}

export { PlacedNode }
