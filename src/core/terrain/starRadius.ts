import type { Actor } from '@/core/models/Actor'
import { resolveLightSource } from '@/core/helpers/lightSource'

/**
 * Радиус светила системы, км (см. resolveLightSource). Нет светила или радиус
 * не положителен — undefined (фолбэк полутени).
 */
export function resolveStarRadiusKm(model: Actor): number | undefined {
  const radius = resolveLightSource(model)?.physicalObject?.getAttribute('radius')

  return typeof radius === 'number' && radius > 0 ? radius : undefined
}
