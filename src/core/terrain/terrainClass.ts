import type { Actor } from '@/core/models/Actor'
import { ATMOSPHERE_CATEGORY_ID } from '@/core/constants'

export type TerrainArchetype = 'rocky' | 'ice' | 'sand' | 'volcanic'
export type TerrainClass = `${TerrainArchetype}-${'airless' | 'atmosphere'}`

export const TERRAIN_CLASSES: readonly TerrainClass[] = [
  'rocky-airless', 'rocky-atmosphere', 'ice-airless', 'ice-atmosphere',
  'sand-airless', 'sand-atmosphere', 'volcanic-airless', 'volcanic-atmosphere'
]

/** Архетип — по точному пути набора детали; другие наборы (астероиды) архетипом не считаются. */
const ARCHETYPE_BY_PATH: Readonly<Record<string, TerrainArchetype>> = {
  'terrain/rocky_trail_diff.webp': 'rocky',
  'terrain/ice_diff.webp': 'ice',
  'terrain/sand_diff.webp': 'sand',
  'terrain/volcanic_diff.webp': 'volcanic'
}

export function terrainArchetypeOf(detailDiffusePath: string | undefined): TerrainArchetype | null {
  return detailDiffusePath === undefined ? null : (ARCHETYPE_BY_PATH[detailDiffusePath] ?? null)
}

/** Класс облика из данных: архетип детали × наличие дочерней атмосферы; без детали — null. */
export function terrainClassOf(model: Actor): TerrainClass | null {
  const path = model.resources?.where('resourceType', 'detailDiffuse').first()?.getAttribute('path') as string | undefined
  const archetype = terrainArchetypeOf(path)
  if (archetype === null) return null
  const atmosphere = model.children?.where('categoryId', ATMOSPHERE_CATEGORY_ID).first() !== undefined
  return `${archetype}-${atmosphere ? 'atmosphere' : 'airless'}`
}
