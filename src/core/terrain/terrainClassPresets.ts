import type { Actor } from '@/core/models/Actor'
import type { IPlanetRenderingObject } from '@/core/models/types'
import { readRenderingData } from '@/core/helpers/renderingData'
import { TERRAIN_CLASSES, terrainClassOf, type TerrainClass } from './terrainClass'

/** Ручки, которые пресет может задавать: ни одна не проставлена в БД (страж TerrainClassData.spec). */
export const TERRAIN_PRESET_KEYS: readonly (keyof IPlanetRenderingObject)[] = [
  'terrainAmbient', 'terrainOcclusionDirect', 'steepTint', 'midbandShade', 'macroStreakStrength', 'macroTerraceStrength',
  'iceGlintStrength', 'frostStrength', 'frostLineMeters', 'frostLineWidthMeters', 'frostPolarDropMeters',
  'frostAspectMeters', 'frostSlopeMax', 'frostColor'
]

const ICE: Readonly<Partial<IPlanetRenderingObject>> = {
  terrainAmbient: 0.22, terrainOcclusionDirect: 0.25, steepTint: 0xd9d9d9, midbandShade: 0.35, macroTerraceStrength: 0.2, iceGlintStrength: 0.35
}

/** Стартовые значения облика по классам; незаданное — дефолт резолвера. */
export const TERRAIN_CLASS_PRESETS: Readonly<Record<TerrainClass, Readonly<Partial<IPlanetRenderingObject>>>> = {
  'rocky-airless': { terrainAmbient: 0.1 },
  'rocky-atmosphere': { terrainAmbient: 0.18, midbandShade: 0.4, macroTerraceStrength: 0.4 },
  'ice-airless': ICE,
  'ice-atmosphere': ICE,
  'sand-atmosphere': { terrainAmbient: 0.18, macroStreakStrength: 0.7, macroTerraceStrength: 0.3 },
  'sand-airless': { terrainAmbient: 0.12 },
  // тёмный набор (средняя яркость 0.09): камень темнее почти не читается под AgX
  'volcanic-atmosphere': { terrainAmbient: 0.16, steepTint: 0xf2f2f2 },
  'volcanic-airless': { terrainAmbient: 0.1, steepTint: 0xf2f2f2 }
}

const FALLBACK: IPlanetRenderingObject = { bumpScale: 0, emission: 1 }

/** Данные облика тела: пресет класса под данными тела; `terrainClass` в данных переопределяет вывод, 'none' — без пресета. */
export function terrainDataOf(model: Actor): IPlanetRenderingObject {
  const raw = readRenderingData<IPlanetRenderingObject>(model)
  const override = raw?.terrainClass
  if (override !== undefined && override !== 'none' && !TERRAIN_CLASSES.includes(override as TerrainClass)) {
    throw new Error(`terrainClass ${model.getAttribute?.('name', '?') ?? '?'}: неизвестный класс ${String(override)}`)
  }
  const cls = override === 'none' ? null : ((override as TerrainClass | undefined) ?? terrainClassOf(model))
  const base = raw ?? FALLBACK
  return cls === null ? base : { ...TERRAIN_CLASS_PRESETS[cls], ...base }
}
