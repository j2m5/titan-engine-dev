import { clamp } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import { IBrownDwarfRenderingObject } from '@/core/models/types'

/** Поздний L / переход L-T: на этой температуре палитра чисто красно-оранжевая */
export const BROWN_DWARF_DEFAULT_TEMPERATURE_K: number = 1600

/**
 * Спред палитры шире звёздного (400K): cool уходит в тёмно-вишнёвый тон
 * палубы, hot — в оранжевое нутро прогалин
 */
export const BROWN_DWARF_PALETTE_SPREAD_K: number = 600

/** Затемнение облачной палубы относительно cool-цвета палитры */
export const BROWN_DWARF_CLOUD_DIM: number = 0.25

export interface BrownDwarfParameters {
  seed: number
  bandCount: number
  jetStrength: number
  turbulence: number
  opticalDepth: number
  gapGlow: number
  parallax: number
  hazeStrength: number
  breathAmplitude: number
  temperature: number
}

const DEFAULTS: Omit<BrownDwarfParameters, 'temperature'> = {
  seed: 4096,
  bandCount: 9,
  jetStrength: 0.6,
  turbulence: 1.6,
  opticalDepth: 3,
  gapGlow: 3,
  parallax: 0.02,
  hazeStrength: 1,
  breathAmplitude: 0.08
}

/**
 * Параметры карлика из данных актора с дефолтами.
 *
 * Значения дефолтов — стартовая точка, посчитанная при проектировании, а НЕ
 * замер на картинке: приёмку по виду делает владелец.
 *
 * Ловушка: `??` вместо `||` принципиален — нулевые значения (выключенное
 * дыхание, выключенный параллакс) обязаны переживать чтение.
 */
export function brownDwarfParameters(actor: Actor): BrownDwarfParameters {
  const data: IBrownDwarfRenderingObject = readRenderingData<IBrownDwarfRenderingObject>(actor) ?? {}

  return {
    seed: data.seed ?? DEFAULTS.seed,
    bandCount: data.bandCount ?? DEFAULTS.bandCount,
    jetStrength: data.jetStrength ?? DEFAULTS.jetStrength,
    turbulence: data.turbulence ?? DEFAULTS.turbulence,
    opticalDepth: data.opticalDepth ?? DEFAULTS.opticalDepth,
    gapGlow: data.gapGlow ?? DEFAULTS.gapGlow,
    parallax: data.parallax ?? DEFAULTS.parallax,
    hazeStrength: data.hazeStrength ?? DEFAULTS.hazeStrength,
    // Кламп, а не просто чтение: bdBreath даёт [1-a, 1+a], и при a > 1
    // яркость нутра уходит в минус — отрицательная светимость
    breathAmplitude: clamp(data.breathAmplitude ?? DEFAULTS.breathAmplitude, 0, 1),
    temperature:
      actor.physicalObject?.getAttribute('temperature', BROWN_DWARF_DEFAULT_TEMPERATURE_K) ??
      BROWN_DWARF_DEFAULT_TEMPERATURE_K
  }
}
