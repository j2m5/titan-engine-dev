/** Ручки направленных форм склона средней полосы (струи/террасы), дефолты глобальные. */
export interface MacroSlopeStructureParams {
  /** Сила струй вниз по склону; 0 — выключено. */
  macroStreakStrength: number
  /** Период струй поперёк потока, км поверхности. */
  macroStreakScaleKm: number
  /** Сила террас (модуляция собственного уклона по полосам горизонталей); 0 — выключено. */
  macroTerraceStrength: number
  /** Вертикальный шаг террас, метры. */
  macroTerraceStepMeters: number
}

const DEFAULTS: MacroSlopeStructureParams = {
  macroStreakStrength: 1,
  macroStreakScaleKm: 0.5,
  macroTerraceStrength: 0.5,
  macroTerraceStepMeters: 150
}

type Raw = { [K in keyof MacroSlopeStructureParams]?: unknown }

/** Заданные в data значения валидируются громко (контекст = имя тела); отсутствующие — дефолт. */
export function resolveMacroSlopeStructureParams(data: Raw | undefined, context: string): MacroSlopeStructureParams {
  const read = (field: keyof MacroSlopeStructureParams): number => {
    const raw = data?.[field]
    if (raw === undefined) return DEFAULTS[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`macroSlopeStructures ${context}: ${field} — не число: ${String(raw)}`)
    }
    return raw
  }

  const params: MacroSlopeStructureParams = {
    macroStreakStrength: read('macroStreakStrength'),
    macroStreakScaleKm: read('macroStreakScaleKm'),
    macroTerraceStrength: read('macroTerraceStrength'),
    macroTerraceStepMeters: read('macroTerraceStepMeters')
  }

  if (params.macroStreakStrength < 0) throw new Error(`macroSlopeStructures ${context}: macroStreakStrength должен быть >= 0: ${params.macroStreakStrength}`)
  if (params.macroTerraceStrength < 0) throw new Error(`macroSlopeStructures ${context}: macroTerraceStrength должен быть >= 0: ${params.macroTerraceStrength}`)
  if (params.macroStreakScaleKm <= 0) throw new Error(`macroSlopeStructures ${context}: macroStreakScaleKm должен быть > 0: ${params.macroStreakScaleKm}`)
  if (params.macroTerraceStepMeters <= 0) throw new Error(`macroSlopeStructures ${context}: macroTerraceStepMeters должен быть > 0: ${params.macroTerraceStepMeters}`)

  return params
}
