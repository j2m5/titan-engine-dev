import type { Actor } from '@/core/models/Actor'

/**
 * Путь карты высот тела, если он есть в БД. Единственное место чтения:
 * фабрика (createPlanet и апгрейд узла) и гейт обязаны видеть один и тот же
 * ресурс, иначе гейт грузил бы одно, а фабрика искала другое.
 */
export function heightPathOf(actor: Actor): string | undefined {
  const path: unknown = actor.resources.where('resourceType', 'height').first()?.getAttribute('path')

  return typeof path === 'string' ? path : undefined
}
