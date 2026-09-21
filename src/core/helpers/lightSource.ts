import { Color } from 'three'
import type { Actor } from '@/core/models/Actor'
import { LIGHT_SOURCE_CATEGORY_IDS } from '@/core/constants'
import { readRenderingData } from '@/core/helpers/renderingData'
import {
  colorTemperatureToRGB,
  DEFAULT_STAR_TEMPERATURE_K,
  normalizeColor,
  srgbColorToLinear
} from '@/core/materials/shaders/lib/helpers'
import type { Colorable } from '@/core/models/types'

/**
 * Светило системы: корень дерева акторов сам светило или держит его прямым
 * ребёнком. Стаб-акторы тестов без parent/children дают undefined.
 *
 * Позицию светила движок в материалы не доставляет («звезда в нуле») — отсюда
 * берутся только его свойства: радиус, температура, подписка на цвет света.
 */
export function resolveLightSource(model: Actor): Actor | undefined {
  let root: Actor = model
  while (root.parent) root = root.parent

  const rootCategory: unknown = root.getAttribute?.('categoryId')

  if (typeof rootCategory === 'number' && LIGHT_SOURCE_CATEGORY_IDS.includes(rootCategory)) return root

  for (const categoryId of LIGHT_SOURCE_CATEGORY_IDS) {
    const found: Actor | undefined = root.children?.where('categoryId', categoryId).first()

    if (found) return found
  }

  return undefined
}

/** Подписка светила на цвет света: доля цвета звезды в прямом свете, [0, 1] */
export function lightTintOf(star: Actor): number {
  const data: { lightTint?: number } | undefined = readRenderingData<{ lightTint?: number }>(star)

  return Math.min(Math.max(data?.lightTint ?? 0, 0), 1)
}

/**
 * Цвет прямого света, linear-sRGB: смесь белого с цветом чёрного тела звезды.
 * Нормировка по максимальному каналу — каналы не превышают 1, поэтому свет
 * звезды темнее белого по яркости; это компенсируется ручкой emission тела.
 */
export function lightColorOf(star: Actor): Color {
  const tint: number = lightTintOf(star)
  const white: Color = new Color(1, 1, 1)

  if (tint === 0) return white

  const temperature: number =
    star.physicalObject?.getAttribute('temperature', DEFAULT_STAR_TEMPERATURE_K) ?? DEFAULT_STAR_TEMPERATURE_K
  const base: Colorable = srgbColorToLinear(normalizeColor(colorTemperatureToRGB(temperature)))

  return white.lerp(new Color().setRGB(base.r, base.g, base.b), tint)
}

/** Гейт и цвет для материала тела: активен только при найденном светиле с подпиской */
export function resolveLightTint(model: Actor): { active: boolean; color: Color } {
  const star: Actor | undefined = resolveLightSource(model)
  const active: boolean = star !== undefined && lightTintOf(star) > 0

  return { active, color: active ? lightColorOf(star!) : new Color(1, 1, 1) }
}
