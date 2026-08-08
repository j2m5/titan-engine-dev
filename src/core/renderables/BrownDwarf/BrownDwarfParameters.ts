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
  turbulence: number
  opticalDepth: number
  gapGlow: number
  gapThreshold: number
  parallax: number
  breathAmplitude: number
  bandWarp: number
  zonalShear: number
  fineDetail: number
  polarChaos: number
  vortexStrength: number
  temperature: number
}

/**
 * Ловушка связанных ручек: `bandWarp` — смещение широты в абсолютных единицах,
 * а ширина пояса равна 1/`bandCount`. Значит при правке числа поясов warp надо
 * масштабировать обратно пропорционально, иначе разброс ширин меняется вместе
 * с ними: половинное число поясов при прежнем warp даёт вдвое более ровные
 * пояса. Пара 4.5 / 0.16 держит ту же относительную неровность, что 9 / 0.08.
 */
const DEFAULTS: Omit<BrownDwarfParameters, 'temperature'> = {
  seed: 4096,
  bandCount: 4.5,
  turbulence: 1.6,
  opticalDepth: 3,
  gapGlow: 3.3,
  gapThreshold: 0.42,
  parallax: 0.02,
  breathAmplitude: 0.08,
  bandWarp: 0.16,
  zonalShear: 0.5,
  fineDetail: 0.25,
  polarChaos: 0.8,
  vortexStrength: 0.35
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
    turbulence: data.turbulence ?? DEFAULTS.turbulence,
    opticalDepth: data.opticalDepth ?? DEFAULTS.opticalDepth,
    gapGlow: data.gapGlow ?? DEFAULTS.gapGlow,
    gapThreshold: data.gapThreshold ?? DEFAULTS.gapThreshold,
    parallax: data.parallax ?? DEFAULTS.parallax,
    // Кламп, а не просто чтение: bdBreath даёт [1-a, 1+a], и при a > 1
    // яркость нутра уходит в минус — отрицательная светимость
    breathAmplitude: clamp(data.breathAmplitude ?? DEFAULTS.breathAmplitude, 0, 1),
    bandWarp: data.bandWarp ?? DEFAULTS.bandWarp,
    zonalShear: data.zonalShear ?? DEFAULTS.zonalShear,
    fineDetail: data.fineDetail ?? DEFAULTS.fineDetail,
    polarChaos: data.polarChaos ?? DEFAULTS.polarChaos,
    vortexStrength: data.vortexStrength ?? DEFAULTS.vortexStrength,
    temperature:
      actor.physicalObject?.getAttribute('temperature', BROWN_DWARF_DEFAULT_TEMPERATURE_K) ??
      BROWN_DWARF_DEFAULT_TEMPERATURE_K
  }
}
