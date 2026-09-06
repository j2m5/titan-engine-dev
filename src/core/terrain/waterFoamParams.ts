/**
 * Ручки пены прибоя (водный шейдер) и мокрой кромки берега (планетный шейдер).
 * Дефолты глобальные; активны только у тел с waterLevelMeters (гейты
 * USE_WATER_WAVES/USE_WATER_DEPTH и USE_WATER_EDGE ставят материалы).
 */
export interface WaterFoamParams {
  /** Сила пены; 0 — выключено. */
  waterFoamStrength: number
  /** Ширина каймы уреза, метры от уреза. */
  waterFoamShoreMeters: number
  /** Сила накатов (параллельных гребней за каймой); 0 — только кайма. */
  waterFoamSurfStrength: number
  /** Дальняя граница зоны накатов, метры от уреза; > waterFoamShoreMeters. */
  waterFoamSurfMeters: number
  /** Шаг накатов, метры. */
  waterFoamWavelengthMeters: number
  /** Период наката и пульса каймы, секунды. */
  waterFoamPeriodSeconds: number
  /** Масштаб рваности относительно ширины каймы. */
  waterFoamNoiseScale: number
  /** Цвет пены: число 0xRRGGBB или строка '#rrggbb' (конвенция waterColor). */
  waterFoamColor: number | string
  /** Ширина мокрой кромки суши над уровнем воды, метры. */
  terrainWetBandMeters: number
  /** Потемнение альбедо под кромкой, 0..1. */
  terrainWetDarken: number
}

export const WATER_FOAM_DEFAULTS: WaterFoamParams = {
  waterFoamStrength: 1,
  // приёмочные дефолты: кайма 1000 м без накатов — на текселе 5–9 км
  // параллельные гребни в километрах друг от друга читались как полосы
  waterFoamShoreMeters: 1000,
  waterFoamSurfStrength: 0,
  waterFoamSurfMeters: 3000,
  waterFoamWavelengthMeters: 800,
  waterFoamPeriodSeconds: 8,
  waterFoamNoiseScale: 1,
  waterFoamColor: 0xe6e9ec,
  terrainWetBandMeters: 3,
  terrainWetDarken: 0.35
}

type Raw = { [K in keyof WaterFoamParams]?: unknown }

type NumericKey = Exclude<keyof WaterFoamParams, 'waterFoamColor'>

/** Заданные в data значения валидируются громко (контекст = имя тела); отсутствующие — дефолт. */
export function resolveWaterFoamParams(data: Raw | undefined, context: string): WaterFoamParams {
  const fail = (message: string): never => {
    throw new Error(`waterFoam ${context}: ${message}`)
  }

  const readNumber = (field: NumericKey): number => {
    const raw = data?.[field]
    if (raw === undefined) return WATER_FOAM_DEFAULTS[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail(`${field} — не число: ${String(raw)}`)

    return raw
  }

  const rawColor = data?.waterFoamColor
  const waterFoamColor: number | string =
    rawColor === undefined
      ? WATER_FOAM_DEFAULTS.waterFoamColor
      : (typeof rawColor === 'number' && Number.isInteger(rawColor) && rawColor >= 0) || typeof rawColor === 'string'
        ? rawColor
        : fail(`waterFoamColor — ожидается 0xRRGGBB или строка: ${String(rawColor)}`)

  const params: WaterFoamParams = {
    waterFoamStrength: readNumber('waterFoamStrength'),
    waterFoamShoreMeters: readNumber('waterFoamShoreMeters'),
    waterFoamSurfStrength: readNumber('waterFoamSurfStrength'),
    waterFoamSurfMeters: readNumber('waterFoamSurfMeters'),
    waterFoamWavelengthMeters: readNumber('waterFoamWavelengthMeters'),
    waterFoamPeriodSeconds: readNumber('waterFoamPeriodSeconds'),
    waterFoamNoiseScale: readNumber('waterFoamNoiseScale'),
    waterFoamColor,
    terrainWetBandMeters: readNumber('terrainWetBandMeters'),
    terrainWetDarken: readNumber('terrainWetDarken')
  }

  if (params.waterFoamStrength < 0) fail(`waterFoamStrength должен быть >= 0: ${params.waterFoamStrength}`)
  if (params.waterFoamShoreMeters <= 0) fail(`waterFoamShoreMeters должен быть > 0: ${params.waterFoamShoreMeters}`)
  if (params.waterFoamSurfStrength < 0) fail(`waterFoamSurfStrength должен быть >= 0: ${params.waterFoamSurfStrength}`)
  if (params.waterFoamSurfMeters <= params.waterFoamShoreMeters) {
    fail(`waterFoamSurfMeters должен быть > waterFoamShoreMeters: ${params.waterFoamSurfMeters} <= ${params.waterFoamShoreMeters}`)
  }
  if (params.waterFoamWavelengthMeters <= 0) fail(`waterFoamWavelengthMeters должен быть > 0: ${params.waterFoamWavelengthMeters}`)
  if (params.waterFoamPeriodSeconds <= 0) fail(`waterFoamPeriodSeconds должен быть > 0: ${params.waterFoamPeriodSeconds}`)
  if (params.waterFoamNoiseScale <= 0) fail(`waterFoamNoiseScale должен быть > 0: ${params.waterFoamNoiseScale}`)
  if (params.terrainWetBandMeters <= 0) fail(`terrainWetBandMeters должен быть > 0: ${params.terrainWetBandMeters}`)
  if (params.terrainWetDarken < 0 || params.terrainWetDarken > 1) fail(`terrainWetDarken должен быть в [0, 1]: ${params.terrainWetDarken}`)

  return params
}
