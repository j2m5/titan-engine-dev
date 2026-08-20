import type { Actor } from '@/core/models/Actor'

/**
 * Путь карты высот тела, если он есть в БД. Единственное место чтения — и
 * теперь это не пожелание в докблоке, а инвариант под тестом
 * (`tests/terrain/HeightPathSingleSource.spec.ts` сканирует `src/`).
 *
 * Потребителей четверо, и решают они разное об одном теле: гейт — что грузить,
 * фабрика — строить рельеф или легаси-сферу, PlanetMaterial — включать ли
 * рельефные дефайны, CameraCollision — терраформный коллайдер или сферу.
 * Разойдись копии в проверке типа или в имени ресурса — тело поедет с
 * рельефной геометрией без рельефного шейдинга либо со сферической коллизией
 * под настоящими горами, и ни одна из этих рассогласовок себя не объявит.
 * Первое такое расхождение уже случалось: к ревью 2026-08-20 (находка №6)
 * копий запроса было три сверх этой.
 */
export function heightPathOf(actor: Actor): string | undefined {
  const path: unknown = actor.resources.where('resourceType', 'height').first()?.getAttribute('path')

  return typeof path === 'string' ? path : undefined
}
