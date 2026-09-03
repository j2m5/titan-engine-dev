/** Ручки зон материала: маска m = smoothstep(start, full, tan + breakup·(vnoise-0.5)); tan-единицы уклона. */
export interface SteepZoneParams {
  steepStart: number
  steepFull: number
  steepBreakup: number
}

const DEFAULTS: SteepZoneParams = { steepStart: 0.35, steepFull: 0.55, steepBreakup: 0.15 }

/** Дефолты глобальные; заданные в data значения валидируются громко (контекст = имя тела). */
export function resolveSteepZoneParams(
  data: { steepStart?: unknown; steepFull?: unknown; steepBreakup?: unknown },
  context: string
): SteepZoneParams {
  const read = (field: keyof SteepZoneParams): number => {
    const raw = data[field]
    if (raw === undefined) return DEFAULTS[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`steepZone ${context}: ${field} — не число: ${String(raw)}`)
    }
    return raw
  }

  const steepStart = read('steepStart')
  const steepFull = read('steepFull')
  const steepBreakup = read('steepBreakup')

  if (steepStart <= 0) throw new Error(`steepZone ${context}: steepStart должен быть > 0: ${steepStart}`)
  if (steepFull <= steepStart) throw new Error(`steepZone ${context}: steepFull должен быть > steepStart: ${steepFull} <= ${steepStart}`)
  if (steepBreakup < 0) throw new Error(`steepZone ${context}: steepBreakup должен быть >= 0: ${steepBreakup}`)

  return { steepStart, steepFull, steepBreakup }
}
