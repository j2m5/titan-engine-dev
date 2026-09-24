import { Actor } from '@/core/models/Actor'
import { DEFAULT_STAR_TEMPERATURE_K, STAR_LIMB_COEFF } from '@/core/materials/shaders/lib/helpers'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { IStarRenderingObject } from '@/core/models/types'

/** Ниже — конвективная оболочка в полную силу (F5 и холоднее), выше — лучистая */
const ACTIVITY_FULL_K = 7000
const ACTIVITY_NONE_K = 9000

/**
 * Конвективная активность звезды по температуре фотосферы, 0..1: грануляция и
 * протуберанцы — следствие конвекции под фотосферой, у A/B/O-звёзд оболочка
 * лучистая, поверхность гладкая. Плавный спад между 7 000 и 9 000 К.
 */
export function starActivityOf(temperatureK: number): number {
  const x = Math.min(1, Math.max(0, (temperatureK - ACTIVITY_FULL_K) / (ACTIVITY_NONE_K - ACTIVITY_FULL_K)))
  return 1 - x * x * (3 - 2 * x)
}

/** Температура фотосферы актора; без физики — дефолт солнечного типа */
export function starTemperatureOf(model: Actor): number {
  return model.physicalObject?.getAttribute('temperature', DEFAULT_STAR_TEMPERATURE_K) ?? DEFAULT_STAR_TEMPERATURE_K
}

/** Активность актора: ручка `activity` строки rendering перекрывает температуру */
export function starActivityFor(model: Actor): number {
  const override = readRenderingData<IStarRenderingObject>(model)?.activity
  if (typeof override === 'number') return Math.min(1, Math.max(0, override))

  return starActivityOf(starTemperatureOf(model))
}

/**
 * Потемнение к лимбу по температуре: у лучистых оболочек вдвое слабее
 * солнечного. Ручка `activity` сюда не входит — лимб свойство фотосферы, а не
 * зерна на ней
 */
export function starLimbCoeffFor(model: Actor): [number, number, number] {
  const k = 0.5 + 0.5 * starActivityOf(starTemperatureOf(model))
  return [STAR_LIMB_COEFF[0] * k, STAR_LIMB_COEFF[1] * k, STAR_LIMB_COEFF[2] * k]
}
