import type { Actor } from '@/core/models/Actor'
import type { IPlanetRenderingObject } from '@/core/models/types'
import { readRenderingData } from '@/core/helpers/renderingData'
import { TERRAIN_CLASSES, terrainClassOf, type TerrainClass } from './terrainClass'

/** Ручки пресета; явно заданные значения тела имеют приоритет. */
export const TERRAIN_PRESET_KEYS: readonly (keyof IPlanetRenderingObject)[] = [
  'terrainAmbient',
  'terrainOcclusionDirect',
  'steepTint',
  'midbandShade',
  'macroStreakStrength',
  'macroTerraceStrength',
  'iceGlintStrength',
  'frostStrength',
  'frostLineMeters',
  'frostLineWidthMeters',
  'frostPolarDropMeters',
  'frostAspectMeters',
  'frostSlopeMax',
  'frostColor',
  'bedrockStrength',
  'bedrockStepMeters',
  'bedrockWeathering',
  'boulderDensity'
]

const ICE: Readonly<Partial<IPlanetRenderingObject>> = {
  terrainAmbient: 0.22,
  terrainOcclusionDirect: 0.25,
  steepTint: 0xd9d9d9,
  midbandShade: 0.35,
  macroTerraceStrength: 0.2,
  iceGlintStrength: 0.35
}

/** Стартовые значения облика по классам; незаданное — дефолт резолвера. */
export const TERRAIN_CLASS_PRESETS: Readonly<Record<TerrainClass, Readonly<Partial<IPlanetRenderingObject>>>> = {
  'rocky-airless': { terrainAmbient: 0.1, bedrockStrength: 0.3, bedrockWeathering: 0.85, boulderDensity: 0.85 },
  'rocky-atmosphere': {
    terrainAmbient: 0.18,
    midbandShade: 0.4,
    macroTerraceStrength: 0.4,
    bedrockStrength: 0.28,
    bedrockWeathering: 1,
    boulderDensity: 0.65
  },
  'ice-airless': ICE,
  'ice-atmosphere': ICE,
  'sand-atmosphere': {
    terrainAmbient: 0.18,
    macroStreakStrength: 0.7,
    macroTerraceStrength: 0.3,
    bedrockStrength: 0.35,
    bedrockWeathering: 0.9,
    boulderDensity: 0.75
  },
  'sand-airless': { terrainAmbient: 0.12, bedrockStrength: 0.32, bedrockWeathering: 0.9, boulderDensity: 0.65 },
  // тёмный набор: steepTint осветляет камень, иначе он не читается
  'volcanic-atmosphere': {
    terrainAmbient: 0.16,
    steepTint: 0xf2f2f2,
    bedrockStrength: 0.36,
    bedrockWeathering: 0.7,
    boulderDensity: 0.7
  },
  'volcanic-airless': {
    terrainAmbient: 0.1,
    steepTint: 0xf2f2f2,
    bedrockStrength: 0.36,
    bedrockWeathering: 0.7,
    boulderDensity: 0.7
  }
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
  if (cls === null) return base
  const preset = TERRAIN_CLASS_PRESETS[cls]
  const radius = model.physicalObject?.getAttribute('radius')
  const radiusKm = typeof radius === 'number' && Number.isFinite(radius) && radius > 0 ? radius : 3390
  // A small moon must not inherit kilometre-scale strata. Explicit body data still wins.
  const scale =
    (preset.bedrockStrength ?? 0) > 0 ? { bedrockStepMeters: Math.max(80, Math.min(800, radiusKm * 0.24)) } : {}
  return { ...preset, ...scale, ...base }
}
