import { Color } from 'three'

/** Иней: маска по высоте карты, широте, экспозиции к полюсу и уклону; сила 0 — выключено. */
export interface FrostParams {
  frostStrength: number
  /** Высота линии инея, метры карты (шкала vHeightMeters). */
  frostLineMeters: number
  /** Ширина перехода, метры. */
  frostLineWidthMeters: number
  /** Понижение линии к полюсу: line − drop·|sin φ|, метры. */
  frostPolarDropMeters: number
  /** Понижение линии на склонах, обращённых к полюсу, метры. */
  frostAspectMeters: number
  /** tan уклона, круче которого иней не держится. */
  frostSlopeMax: number
  /** Цвет инея (hex sRGB → линейный). */
  frostColor: Color
}

const DEFAULTS = {
  frostStrength: 0, frostLineMeters: 0, frostLineWidthMeters: 500, frostPolarDropMeters: 0, frostAspectMeters: 0, frostSlopeMax: 0.6
}

export function resolveFrostParams(data: Partial<Record<keyof FrostParams, unknown>> | undefined, context: string): FrostParams {
  const read = (field: keyof typeof DEFAULTS): number => {
    const raw = data?.[field]
    if (raw === undefined) return DEFAULTS[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`frost ${context}: ${field} — не число: ${String(raw)}`)
    return raw
  }
  const p = {
    frostStrength: read('frostStrength'), frostLineMeters: read('frostLineMeters'), frostLineWidthMeters: read('frostLineWidthMeters'),
    frostPolarDropMeters: read('frostPolarDropMeters'), frostAspectMeters: read('frostAspectMeters'), frostSlopeMax: read('frostSlopeMax')
  }
  if (p.frostStrength < 0 || p.frostStrength > 1) throw new Error(`frost ${context}: frostStrength должен быть в [0, 1]: ${p.frostStrength}`)
  if (p.frostLineWidthMeters <= 0) throw new Error(`frost ${context}: frostLineWidthMeters должен быть > 0: ${p.frostLineWidthMeters}`)
  if (p.frostSlopeMax <= 0) throw new Error(`frost ${context}: frostSlopeMax должен быть > 0: ${p.frostSlopeMax}`)
  if (p.frostPolarDropMeters < 0) throw new Error(`frost ${context}: frostPolarDropMeters должен быть >= 0: ${p.frostPolarDropMeters}`)
  if (p.frostAspectMeters < 0) throw new Error(`frost ${context}: frostAspectMeters должен быть >= 0: ${p.frostAspectMeters}`)

  const rawColor = data?.frostColor
  let frostColor: Color
  if (rawColor === undefined) frostColor = new Color(0xf0f2f5)
  else if (typeof rawColor === 'number' || typeof rawColor === 'string') frostColor = new Color(rawColor)
  else throw new Error(`frost ${context}: frostColor — hex-число или строка: ${String(rawColor)}`)

  return { ...p, frostColor }
}
