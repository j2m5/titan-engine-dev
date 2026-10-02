/** Ручки поверхности воды (арка «Вода 2»); дефолты глобальные, активны у тел с waterLevelMeters. */
export interface WaterSurfaceParams {
  /** Базовая шероховатость блика — капиллярная рябь мельче 10 м, (0, 1]. */
  waterRoughness: number
  /** Коэффициенты поглощения толщи по каналам RGB, 1/м. */
  waterAbsorption: [number, number, number]
  /** Сила мелких октав 2560–10 м; 0 — только крупные. */
  waterRippleStrength: number
  /** Множитель блика воды (и легаси-блика тела с водой); 1 — одобренный ближний вид бит-в-бит. */
  waterGlintGain: number
}

export const WATER_SURFACE_DEFAULTS: WaterSurfaceParams = {
  waterRoughness: 0.02,
  waterAbsorption: [0.45, 0.07, 0.03],
  waterRippleStrength: 1,
  waterGlintGain: 1
}

type Raw = { [K in keyof WaterSurfaceParams]?: unknown }

/** Заданные в data значения валидируются громко (контекст = имя тела); отсутствующие — дефолт. */
export function resolveWaterSurfaceParams(data: Raw | undefined, context: string): WaterSurfaceParams {
  const fail = (message: string): never => {
    throw new Error(`waterSurface ${context}: ${message}`)
  }
  const readNumber = (field: 'waterRoughness' | 'waterRippleStrength' | 'waterGlintGain'): number => {
    const raw = data?.[field]
    if (raw === undefined) return WATER_SURFACE_DEFAULTS[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail(`${field} — не число: ${String(raw)}`)

    return raw
  }

  const roughness = readNumber('waterRoughness')
  if (roughness <= 0 || roughness > 1) fail(`waterRoughness должен быть в (0, 1]: ${roughness}`)
  const ripple = readNumber('waterRippleStrength')
  if (ripple < 0) fail(`waterRippleStrength должен быть >= 0: ${ripple}`)
  const glintGain = readNumber('waterGlintGain')
  if (glintGain < 0) fail(`waterGlintGain должен быть >= 0: ${glintGain}`)

  const rawAbsorption = data?.waterAbsorption
  let absorption = WATER_SURFACE_DEFAULTS.waterAbsorption
  if (rawAbsorption !== undefined) {
    if (!Array.isArray(rawAbsorption) || rawAbsorption.length !== 3) fail('waterAbsorption — нужно три числа [r, g, b]')
    const values = rawAbsorption as unknown[]
    for (const v of values) {
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(`waterAbsorption — не число: ${String(v)}`)
      if ((v as number) <= 0) fail(`waterAbsorption — каждый коэффициент > 0: ${String(v)}`)
    }
    absorption = [values[0] as number, values[1] as number, values[2] as number]
  }

  return { waterRoughness: roughness, waterAbsorption: absorption, waterRippleStrength: ripple, waterGlintGain: glintGain }
}
