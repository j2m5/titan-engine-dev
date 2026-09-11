import type { Actor } from '@/core/models/Actor'
import { STAR_CATEGORY_ID } from '@/core/constants'

/**
 * Радиус звезды системы, км: корень дерева акторов сам звезда или держит её
 * ребёнком. Стаб-акторы тестов без parent/children — undefined (фолбэк полутени).
 */
export function resolveStarRadiusKm(model: Actor): number | undefined {
  let root: Actor = model
  while (root.parent) root = root.parent
  const star =
    root.getAttribute?.('categoryId') === STAR_CATEGORY_ID
      ? root
      : root.children?.where('categoryId', STAR_CATEGORY_ID).first()
  const radius = star?.physicalObject?.getAttribute('radius')
  return typeof radius === 'number' && radius > 0 ? radius : undefined
}
