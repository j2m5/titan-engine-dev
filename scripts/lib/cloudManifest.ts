import type { IResource } from '@/core/models/types'
import { terrainAuxPathFor } from '@/core/terrain/terrainAuxFormat'
import { shapeModelManifestPaths } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/shapeModelPaths'

/**
 * Манифест облака: точный список файлов под `storage/images/textures`,
 * которые читает рантайм. Синк бакета гонится по этому белому списку —
 * чёрные списки паттернов (`*.prev.*`, `*elevation*`, …) хрупки: локально
 * рядом с боевыми картами живут бэкапы арок и исходники конвейера
 * (~3.6 ГиБ на 2026-08-31), которым в облаке делать нечего.
 */

/**
 * Файлы, которые код грузит напрямую, мимо строк БД: текстуры бликов
 * (`LensFlareEffect`: Storage.url) и глоу солнца (`GalaxyShader`:
 * resourceStorage.getTexture по имени). Новый такой файл обязан попасть сюда —
 * иначе манифест его не увидит и деплой останется без него.
 */
export const CODE_REFERENCED_PATHS: readonly string[] = ['lenscolor.png', 'lensstar.png', 'sun_glow.png']

/**
 * Пути ресурсов БД + производные `.aux` height-карт (рантайм выводит путь
 * компаньона сам — строки в БД нет) + статические файлы кода; уникально,
 * отсортировано.
 */
export function cloudManifestPaths(resources: readonly IResource[]): string[] {
  // Реальные модели форм астероидов: строк в БД нет, имена живут в профилях
  // породы (AsteroidProfiles.shapeModels), рантайм грузит их сам
  const paths = new Set<string>([...CODE_REFERENCED_PATHS, ...shapeModelManifestPaths()])

  for (const resource of resources) {
    paths.add(resource.path)
    if (resource.resourceType === 'height') paths.add(terrainAuxPathFor(resource.path))
  }

  return [...paths].sort()
}
