import { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import { IGiantStarRenderingObject } from '@/core/models/types'
import {
  COLOR_TEMPERATURE_FLOOR_K,
  STAR_CORE_INTENSITY,
  visibleBandRadianceRatio
} from '@/core/materials/shaders/lib/helpers'

/** Типичный красный сверхгигант */
export const GIANT_STAR_DEFAULT_TEMPERATURE_K: number = 3700

/**
 * Посадка яркости в HDR-коридор движка, НЕ физика. Честная поверхность
 * сверхгиганта в видимой полосе на порядок тусклее солнечной и в кадре не
 * светится. Отношение яркостей между гигантами разных температур сохраняется:
 * планковский множитель остаётся внутри. Значение стартовое.
 */
export const GIANT_STAR_DISPLAY_SCALE: number = 6

/** Размах температуры ячеек вокруг базы при cellContrast = 1, кельвины */
export const GIANT_STAR_CELL_SPREAD_K: number = 700

/** Множитель времени поверхности: гигантские ячейки живут медленнее солнечных */
export const GIANT_STAR_TIME_SCALE: number = 0.004

export interface GiantStarParameters {
  temperature: number
  seed: number
  cellCount: number
  cellContrast: number
  atmosphereHeight: number
  atmosphereDensity: number
  exposureBias: number
  /** Фактический спред палитры после клампа по полу цветовой температуры */
  spreadK: number
}

const DEFAULTS: Required<IGiantStarRenderingObject> = {
  seed: 1,
  /** Масштаб домена: ячейка около R/3. Сверхгигант 4–6, обычный гигант 15–30 */
  cellCount: 5,
  cellContrast: 1,
  /** Полная протяжённость оболочки в долях радиуса */
  atmosphereHeight: 0.3,
  /** Толща касательного луча; ноль гасит оболочку */
  atmosphereDensity: 1,
  /** Поверх откалиброванного уровня; ноль гасит тело */
  exposureBias: 1
}

/**
 * Параметры гиганта из данных актора. Цвет, яркость и лимб выводятся из
 * температуры физического объекта и в данных не задаются — иначе их можно
 * развести между собой.
 *
 * `??`, а не `||`: нули — точки отката и обязаны переживать чтение.
 */
export function giantStarParameters(actor: Actor): GiantStarParameters {
  const data: IGiantStarRenderingObject = readRenderingData<IGiantStarRenderingObject>(actor) ?? {}
  const temperature: number =
    actor.physicalObject?.getAttribute('temperature', GIANT_STAR_DEFAULT_TEMPERATURE_K) ??
    GIANT_STAR_DEFAULT_TEMPERATURE_K
  const cellContrast: number = Math.max(data.cellContrast ?? DEFAULTS.cellContrast, 0)

  return {
    temperature,
    seed: data.seed ?? DEFAULTS.seed,
    cellCount: Math.max(data.cellCount ?? DEFAULTS.cellCount, 1),
    cellContrast,
    atmosphereHeight: Math.min(Math.max(data.atmosphereHeight ?? DEFAULTS.atmosphereHeight, 0.01), 2),
    atmosphereDensity: Math.max(data.atmosphereDensity ?? DEFAULTS.atmosphereDensity, 0),
    exposureBias: Math.max(data.exposureBias ?? DEFAULTS.exposureBias, 0),
    // Холодный стоп палитры не имеет права уйти ниже пола: цвет сменился бы молча
    spreadK: Math.max(Math.min(GIANT_STAR_CELL_SPREAD_K * cellContrast, temperature - COLOR_TEMPERATURE_FLOOR_K), 0)
  }
}

/**
 * Яркость стопов палитры относительно базового, в видимой полосе. Считается из
 * тех же температур, что и цвет: горячая ячейка не может оказаться тусклой.
 */
export function giantStarCellEnergy(temperatureK: number, spreadK: number): [number, number, number] {
  if (spreadK === 0) return [1, 1, 1]

  return [
    visibleBandRadianceRatio(temperatureK - spreadK, temperatureK),
    1,
    visibleBandRadianceRatio(temperatureK + spreadK, temperatureK)
  ]
}

/** HDR-яркость базовой ячейки в центре диска */
export function giantStarIntensity(params: GiantStarParameters): number {
  return (
    STAR_CORE_INTENSITY * visibleBandRadianceRatio(params.temperature) * GIANT_STAR_DISPLAY_SCALE * params.exposureBias
  )
}
