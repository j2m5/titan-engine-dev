/**
 * CPU-зеркало GLSL-чанка whiteDwarfSurface.
 *
 * Построчная копия шейдерных функций: числа гоняются здесь, потому что GLSL из
 * vitest не исполнить. Менять строго синхронно с
 * src/core/materials/shaders/lib/chunks/WhiteDwarfSurface.ts — расхождение
 * ловится тестом «числовые константы GLSL синхронизированы с зеркалом».
 *
 * Намеренно повторяет `exp(x) - 1.0`, а не Math.expm1: зеркало обязано
 * воспроизводить то, что реально считает шейдер, включая точность.
 */

import { planckLimb, PLANCK_LIMB_EDDINGTON_TAU, type Vec3 } from '../helpers/planckLimbMirror'

export type { Vec3 }

/** Прежние имена сохранены: числовые тесты карлика не меняются ни строкой */
export const WD_EDDINGTON_TAU: number = PLANCK_LIMB_EDDINGTON_TAU
export const wdLimb = planckLimb

export const WD_HDR_CEILING: number = 32.0

/** Зеркало wdShade */
export function wdShade(mu: number, baseColor: Vec3, planckX: Vec3, intensity: number, exposure: number): Vec3 {
  const limb: Vec3 = wdLimb(mu, planckX)

  return baseColor.map((c: number, i: number) => Math.min(c * intensity * limb[i], WD_HDR_CEILING) * exposure) as Vec3
}

/**
 * Коэффициент линейного закона потемнения u = 1 - I(0)/I(1) для одного канала.
 * Не участвует в шейдере — способ выразить результат wdLimb в привычной
 * астрономической величине, по которой и ставятся пины.
 */
export function limbDarkeningCoefficient(planckXChannel: number): number {
  return 1 - wdLimb(0, [planckXChannel, planckXChannel, planckXChannel])[0]
}
