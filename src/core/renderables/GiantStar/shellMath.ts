/**
 * Интеграл оптической толщи оболочки на CPU. Всё в единицах радиуса звезды.
 *
 * Двойная роль: считает нормировку ручки atmosphereDensity и служит зеркалом
 * GLSL-чанка giantStarShell — менять строго синхронно с ним.
 */

export type Vec3 = [number, number, number]

/** Шагов интеграла по средним точкам */
export const SHELL_STEPS: number = 8

/** Шкала высот как доля полной протяжённости оболочки */
export const SHELL_SCALE_FRACTION: number = 0.25

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Плотность на расстоянии r от центра, 1 на фотосфере. Экспонента сдвинута так,
 * чтобы на верхней границе был РОВНО ноль: иначе на краю прокси виден обрыв.
 */
export function shellDensity(r: number, h: number): number {
  const scale: number = h * SHELL_SCALE_FRACTION
  const floor: number = Math.exp(-h / scale)

  return Math.max(Math.exp(-(r - 1) / scale) - floor, 0) / (1 - floor)
}

/**
 * Толща вдоль луча до нормировки. dir обязан быть единичным.
 * clipCore = false — луч идёт сквозь фотосферу; нужно только для нормировки
 * по касательному лучу, у которого пересечение с ядром вырождено.
 */
export function shellOpticalDepth(origin: Vec3, dir: Vec3, h: number, clipCore: boolean = true): number {
  const b: number = dot(origin, dir)
  const oo: number = dot(origin, origin)
  const outer: number = 1 + h
  const discOuter: number = b * b - (oo - outer * outer)

  if (discOuter <= 0) return 0

  const rootOuter: number = Math.sqrt(discOuter)
  const t0: number = Math.max(-b - rootOuter, 0)
  let t1: number = -b + rootOuter

  if (clipCore) {
    const discCore: number = b * b - (oo - 1)

    if (discCore > 0) {
      const tCore: number = -b - Math.sqrt(discCore)

      if (tCore > 0) t1 = Math.min(t1, tCore)
    }
  }

  if (t1 <= t0) return 0

  const dt: number = (t1 - t0) / SHELL_STEPS
  let sum: number = 0

  for (let i = 0; i < SHELL_STEPS; i++) {
    const t: number = t0 + (i + 0.5) * dt
    const r: number = Math.sqrt(oo + 2 * b * t + t * t)

    sum += shellDensity(r, h)
  }

  return sum * dt
}

/** Множитель, при котором касательный луч набирает ровно tangentTau */
export function shellDensityScale(h: number, tangentTau: number): number {
  const tangent: number = shellOpticalDepth([-(2 + h), 1, 0], [1, 0, 0], h, false)

  return tangent > 0 ? tangentTau / tangent : 0
}
