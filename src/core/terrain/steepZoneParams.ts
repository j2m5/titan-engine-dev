import { Color } from 'three'

/** Ручки зон материала: маска m = smoothstep(start, full, tan + breakup·(vnoise-0.5)); tan-единицы уклона. */
export interface SteepZoneParams {
  steepStart: number
  steepFull: number
  steepBreakup: number
  /** Цвет каменной зоны на крутом; множитель в линейном свете. */
  steepTint: Color
}

const DEFAULTS: SteepZoneParams = {
  steepStart: 0.35,
  steepFull: 0.55,
  steepBreakup: 0.15,
  // hex читается как sRGB → линейный ≈ 0.80: камень на 20 % темнее родного
  // набора в линейном свете; 0xffffff — нейтрально.
  steepTint: new Color(0xe7e7e7)
}

/** Дефолты глобальные; заданные в data значения валидируются громко (контекст = имя тела). */
export function resolveSteepZoneParams(
  data: { steepStart?: unknown; steepFull?: unknown; steepBreakup?: unknown; steepTint?: unknown },
  context: string
): SteepZoneParams {
  const read = (field: 'steepStart' | 'steepFull' | 'steepBreakup'): number => {
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

  const rawTint = data.steepTint
  let steepTint: Color
  if (rawTint === undefined) steepTint = DEFAULTS.steepTint.clone()
  else if (typeof rawTint === 'number' || typeof rawTint === 'string') steepTint = new Color(rawTint)
  else throw new Error(`steepZone ${context}: steepTint — hex-число или строка: ${String(rawTint)}`)

  return { steepStart, steepFull, steepBreakup, steepTint }
}
