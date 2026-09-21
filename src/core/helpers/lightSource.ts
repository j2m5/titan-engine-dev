import type { Actor } from '@/core/models/Actor'
import { LIGHT_SOURCE_CATEGORY_IDS } from '@/core/constants'

/**
 * Светило системы: корень дерева акторов сам светило или держит его прямым
 * ребёнком. Стаб-акторы тестов без parent/children дают undefined.
 *
 * Позицию светила движок в материалы не доставляет («звезда в нуле») — отсюда
 * берутся только его свойства: радиус, температура, подписка на цвет света.
 */
export function resolveLightSource(model: Actor): Actor | undefined {
  let root: Actor = model
  while (root.parent) root = root.parent

  const rootCategory: unknown = root.getAttribute?.('categoryId')

  if (typeof rootCategory === 'number' && LIGHT_SOURCE_CATEGORY_IDS.includes(rootCategory)) return root

  for (const categoryId of LIGHT_SOURCE_CATEGORY_IDS) {
    const found: Actor | undefined = root.children?.where('categoryId', categoryId).first()

    if (found) return found
  }

  return undefined
}
