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

export type Vec3 = [number, number, number]

export const WD_EDDINGTON_TAU: number = 0.66666667
export const WD_HDR_CEILING: number = 32.0

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Зеркало wdLimb */
export function wdLimb(mu: number, planckX: Vec3): Vec3 {
  const m: number = clamp(mu, 0.0, 1.0)
  const sMu: number = Math.pow(0.75 * (m + WD_EDDINGTON_TAU), 0.25)
  const sOne: number = Math.pow(0.75 * (1.0 + WD_EDDINGTON_TAU), 0.25)

  return planckX.map((x: number) => (Math.exp(x / sOne) - 1.0) / (Math.exp(x / sMu) - 1.0)) as Vec3
}

/** Зеркало wdShade */
export function wdShade(mu: number, baseColor: Vec3, planckX: Vec3, intensity: number): Vec3 {
  const limb: Vec3 = wdLimb(mu, planckX)

  return baseColor.map((c: number, i: number) => Math.min(c * intensity * limb[i], WD_HDR_CEILING)) as Vec3
}

/**
 * Коэффициент линейного закона потемнения u = 1 - I(0)/I(1) для одного канала.
 * Не участвует в шейдере — способ выразить результат wdLimb в привычной
 * астрономической величине, по которой и ставятся пины.
 */
export function limbDarkeningCoefficient(planckXChannel: number): number {
  return 1 - wdLimb(0, [planckXChannel, planckXChannel, planckXChannel])[0]
}
