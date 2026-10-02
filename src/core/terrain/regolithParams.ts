import { Actor } from '@/core/models/Actor'
import { ATMOSPHERE_CATEGORY_ID } from '@/core/constants'
import { terrainDataOf } from '@/core/terrain/terrainClassPresets'

/** Закон реголита безатмосферных тел: Lommel–Seeliger + оппозиционный всплеск (чанк AsteroidBrdf). */
export interface RegolithParams {
  /** Доля Ломмеля–Зелигера против ламберта, [0, 1]; 0 — прежний ламберт. */
  regolithMix: number
  /** Сила оппозиционного всплеска, ≥ 0. */
  oppositionSurge: number
}

/** Тот же всплеск, что у камней колец. */
export const DEFAULT_OPPOSITION_SURGE = 0.3

type Raw = { regolithMix?: unknown; oppositionSurge?: unknown }

/** Заданные в данных значения валидируются громко (контекст — имя тела); доля по умолчанию — 1 без атмосферы, 0 с ней. */
export function resolveRegolithParams(data: Raw | undefined, hasAtmosphere: boolean, context: string): RegolithParams {
  const fail = (message: string): never => {
    throw new Error(`regolith ${context}: ${message}`)
  }
  const read = (field: keyof Raw, fallback: number): number => {
    const raw = data?.[field]
    if (raw === undefined) return fallback
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail(`${field} — не число: ${String(raw)}`)
    return raw
  }

  const regolithMix = read('regolithMix', hasAtmosphere ? 0 : 1)
  if (regolithMix < 0 || regolithMix > 1) fail(`regolithMix должен быть в [0, 1]: ${regolithMix}`)
  const oppositionSurge = read('oppositionSurge', DEFAULT_OPPOSITION_SURGE)
  if (oppositionSurge < 0) fail(`oppositionSurge должен быть >= 0: ${oppositionSurge}`)

  return { regolithMix, oppositionSurge }
}

/** Параметры реголита тела: атмосфера — по актору-ребёнку, данные — пресет класса под данными тела. */
export function regolithParamsOf(model: Actor): RegolithParams {
  const hasAtmosphere = model.children.where('categoryId', ATMOSPHERE_CATEGORY_ID).isNotEmpty()

  return resolveRegolithParams(terrainDataOf(model), hasAtmosphere, String(model.getAttribute?.('name', '?') ?? '?'))
}
