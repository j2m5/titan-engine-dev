import type { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { IPlanetRenderingObject } from '@/core/models/types'

/** Ручки геометрии средней полосы (арка B); дефолты глобальные, БД не трогается. */
export interface MidbandParams {
  /** Множитель амплитуды; 0 — полоса выключена, поле = карта бит-в-бит. */
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
}

export const MIDBAND_DEFAULTS: MidbandParams = {
  midbandStrength: 1,
  midbandWavelengthKm: null,
  midbandFlat: 0.15,
  midbandSlopeRef: 0.15,
  midbandRidge: 1,
  midbandWarp: 0.35
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
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`midband ${context}: ${field} — не число: ${String(v)}`)
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

  const params: MidbandParams = {
    midbandStrength: num('midbandStrength', MIDBAND_DEFAULTS.midbandStrength),
    midbandWavelengthKm,
    midbandFlat: num('midbandFlat', MIDBAND_DEFAULTS.midbandFlat),
    midbandSlopeRef: num('midbandSlopeRef', MIDBAND_DEFAULTS.midbandSlopeRef),
    midbandRidge: num('midbandRidge', MIDBAND_DEFAULTS.midbandRidge),
    midbandWarp: num('midbandWarp', MIDBAND_DEFAULTS.midbandWarp)
  }

  if (params.midbandStrength < 0) throw new Error(`midband ${context}: midbandStrength должен быть >= 0: ${params.midbandStrength}`)
  if (params.midbandFlat < 0) throw new Error(`midband ${context}: midbandFlat должен быть >= 0: ${params.midbandFlat}`)
  if (params.midbandSlopeRef <= 0) throw new Error(`midband ${context}: midbandSlopeRef должен быть > 0: ${params.midbandSlopeRef}`)
  if (params.midbandRidge < 0) throw new Error(`midband ${context}: midbandRidge должен быть >= 0: ${params.midbandRidge}`)
  if (params.midbandWarp < 0) throw new Error(`midband ${context}: midbandWarp должен быть >= 0: ${params.midbandWarp}`)

  return params
}

/** Единая точка чтения для RenderableFactory и CameraCollision — иначе кеш полей разойдётся. */
export function midbandParamsOf(model: Actor): MidbandParams {
  return resolveMidbandParams(readRenderingData<IPlanetRenderingObject>(model), model.getAttribute?.('name', '?') ?? '?')
}

/** Базовая длина волны, метры: под текселем карты, в коридоре 0.8..3 км; явная ручка — как есть. */
export function midbandWavelengthMeters(equatorTexelMeters: number, params: MidbandParams): number {
  if (params.midbandWavelengthKm !== null) return params.midbandWavelengthKm * 1000

  return Math.min(MAX_WAVELENGTH_METERS, Math.max(MIN_WAVELENGTH_METERS, TEXEL_TO_WAVELENGTH * equatorTexelMeters))
}

export function midbandCacheKey(params: MidbandParams): string {
  return [
    params.midbandStrength,
    params.midbandWavelengthKm ?? 'auto',
    params.midbandFlat,
    params.midbandSlopeRef,
    params.midbandRidge,
    params.midbandWarp
  ].join('|')
}
