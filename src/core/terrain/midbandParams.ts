import type { Actor } from '@/core/models/Actor'
import { terrainDataOf } from '@/core/terrain/terrainClassPresets'

/** Параметры средней полосы и геометрических уступов; переопределяются данными тела. */
export interface MidbandParams {
  /** Сила геометрических уступов, [0,1]; 0 — отключены независимо от средней полосы. */
  bedrockStrength: number
  /** Вертикальный шаг пластов, метры. */
  bedrockStepMeters: number
  /** Сколы кромок и осыпь у подножия уступов, [0,1]. */
  bedrockWeathering: number
  /** Множитель амплитуды шума; 0 — шум выключен независимо от уступов. */
  midbandStrength: number
  /** Базовая длина волны, км; null — авто: clamp(1.2·тексель, 0.8, 3). */
  midbandWavelengthKm: number | null
  /** Доля амплитуды на равнине (огибающая при нулевом уклоне и кривизне). */
  midbandFlat: number
  /** Уклон карты (tan), при котором огибающая склона достигает 1. */
  midbandSlopeRef: number
  /** Вес выпуклой кривизны (кромки/гребни) в огибающей. */
  midbandRidge: number
  /** Варп домена вдоль стока, в долях базовой длины волны. */
  midbandWarp: number
  /** Сила альбедо полосы от её геометрии (гребни светлее, лощины темнее); 0 — прежний вид. */
  midbandShade: number
  /** Уровень воды тела, метры над референсом; null — воды нет, огибающая от уровня не зависит. */
  waterLevelMeters: number | null
  /** Ширина затухания полосы у уровня воды, метры; null — 2·A₀ (две амплитуды базовой октавы). */
  midbandWaterFadeMeters: number | null
}

export const MIDBAND_DEFAULTS: MidbandParams = {
  bedrockStrength: 0,
  bedrockStepMeters: 800,
  bedrockWeathering: 0,
  midbandStrength: 1,
  midbandWavelengthKm: null,
  midbandFlat: 0.15,
  midbandSlopeRef: 0.15,
  midbandRidge: 1,
  midbandWarp: 0.35,
  midbandShade: 0.5,
  waterLevelMeters: null,
  midbandWaterFadeMeters: null
}

const MIN_WAVELENGTH_METERS = 800
const MAX_WAVELENGTH_METERS = 3000
const TEXEL_TO_WAVELENGTH = 1.2

type Raw = { [K in keyof MidbandParams]?: unknown }

export function resolveMidbandParams(data: unknown, context: string): MidbandParams {
  const raw = (data ?? {}) as Raw
  const num = (field: keyof MidbandParams, fallback: number): number => {
    const v = raw[field]
    if (v === undefined) return fallback
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new Error(`midband ${context}: ${field} — не число: ${String(v)}`)
    return v
  }

  const wavelengthRaw = raw.midbandWavelengthKm
  let midbandWavelengthKm: number | null = null
  if (wavelengthRaw !== undefined && wavelengthRaw !== null) {
    if (typeof wavelengthRaw !== 'number' || !Number.isFinite(wavelengthRaw) || wavelengthRaw <= 0) {
      throw new Error(`midband ${context}: midbandWavelengthKm должен быть > 0: ${String(wavelengthRaw)}`)
    }
    midbandWavelengthKm = wavelengthRaw
  }

  const waterFadeRaw = raw.midbandWaterFadeMeters
  let midbandWaterFadeMeters: number | null = null
  if (waterFadeRaw !== undefined && waterFadeRaw !== null) {
    if (typeof waterFadeRaw !== 'number' || !Number.isFinite(waterFadeRaw) || waterFadeRaw <= 0) {
      throw new Error(`midband ${context}: midbandWaterFadeMeters должен быть > 0: ${String(waterFadeRaw)}`)
    }
    midbandWaterFadeMeters = waterFadeRaw
  }

  const waterLevelRaw = raw.waterLevelMeters
  let waterLevelMeters: number | null = null
  if (waterLevelRaw !== undefined && waterLevelRaw !== null) {
    if (typeof waterLevelRaw !== 'number' || !Number.isFinite(waterLevelRaw)) {
      throw new Error(`midband ${context}: waterLevelMeters — не число: ${String(waterLevelRaw)}`)
    }
    waterLevelMeters = waterLevelRaw
  }

  const params: MidbandParams = {
    bedrockStrength: num('bedrockStrength', MIDBAND_DEFAULTS.bedrockStrength),
    bedrockStepMeters: num('bedrockStepMeters', MIDBAND_DEFAULTS.bedrockStepMeters),
    bedrockWeathering: num('bedrockWeathering', MIDBAND_DEFAULTS.bedrockWeathering),
    midbandStrength: num('midbandStrength', MIDBAND_DEFAULTS.midbandStrength),
    midbandWavelengthKm,
    midbandFlat: num('midbandFlat', MIDBAND_DEFAULTS.midbandFlat),
    midbandSlopeRef: num('midbandSlopeRef', MIDBAND_DEFAULTS.midbandSlopeRef),
    midbandRidge: num('midbandRidge', MIDBAND_DEFAULTS.midbandRidge),
    midbandWarp: num('midbandWarp', MIDBAND_DEFAULTS.midbandWarp),
    midbandShade: num('midbandShade', MIDBAND_DEFAULTS.midbandShade),
    waterLevelMeters,
    midbandWaterFadeMeters
  }

  if (params.bedrockStrength < 0 || params.bedrockStrength > 1)
    throw new Error(`terrain ${context}: bedrockStrength должен быть в [0,1]: ${params.bedrockStrength}`)
  if (params.bedrockStepMeters <= 0)
    throw new Error(`terrain ${context}: bedrockStepMeters должен быть > 0: ${params.bedrockStepMeters}`)
  if (params.bedrockWeathering < 0 || params.bedrockWeathering > 1)
    throw new Error(`terrain ${context}: bedrockWeathering должен быть в [0,1]: ${params.bedrockWeathering}`)
  if (params.midbandStrength < 0)
    throw new Error(`midband ${context}: midbandStrength должен быть >= 0: ${params.midbandStrength}`)
  if (params.midbandFlat < 0) throw new Error(`midband ${context}: midbandFlat должен быть >= 0: ${params.midbandFlat}`)
  if (params.midbandSlopeRef <= 0)
    throw new Error(`midband ${context}: midbandSlopeRef должен быть > 0: ${params.midbandSlopeRef}`)
  if (params.midbandRidge < 0)
    throw new Error(`midband ${context}: midbandRidge должен быть >= 0: ${params.midbandRidge}`)
  if (params.midbandWarp < 0) throw new Error(`midband ${context}: midbandWarp должен быть >= 0: ${params.midbandWarp}`)
  if (params.midbandShade < 0)
    throw new Error(`midband ${context}: midbandShade должен быть >= 0: ${params.midbandShade}`)

  return params
}

/** Единая точка чтения для RenderableFactory и CameraCollision — иначе кеш полей разойдётся; данные — с пресетом класса. */
export function midbandParamsOf(model: Actor): MidbandParams {
  return resolveMidbandParams(terrainDataOf(model), model.getAttribute?.('name', '?') ?? '?')
}

/** Базовая длина волны, метры: под текселем карты, в коридоре 0.8..3 км; явная ручка — как есть. */
export function midbandWavelengthMeters(equatorTexelMeters: number, params: MidbandParams): number {
  if (params.midbandWavelengthKm !== null) return params.midbandWavelengthKm * 1000

  return Math.min(MAX_WAVELENGTH_METERS, Math.max(MIN_WAVELENGTH_METERS, TEXEL_TO_WAVELENGTH * equatorTexelMeters))
}

/** Ключ кеша поля высот: midbandShade сюда НЕ входит — ручка пиксельная (альбедо в шейдере), геометрия от неё не зависит. */
export function midbandCacheKey(params: MidbandParams): string {
  return [
    params.bedrockStrength,
    params.bedrockStepMeters,
    params.bedrockWeathering,
    params.midbandStrength,
    params.midbandWavelengthKm ?? 'auto',
    params.midbandFlat,
    params.midbandSlopeRef,
    params.midbandRidge,
    params.midbandWarp,
    params.waterLevelMeters ?? 'dry',
    params.midbandWaterFadeMeters ?? 'auto'
  ].join('|')
}
