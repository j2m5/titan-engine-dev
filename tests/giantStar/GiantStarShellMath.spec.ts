import { describe, it, expect } from 'vitest'
import {
  shellDensity,
  shellOpticalDepth,
  shellDensityScale,
  SHELL_STEPS,
  SHELL_SCALE_FRACTION,
  type Vec3
} from '@/core/renderables/GiantStar/shellMath'

const H: number = 0.3
const FAR: number = 10
const TOWARDS: Vec3 = [1, 0, 0]

/** Параллельный луч вдоль +X с прицельным параметром b */
function ray(b: number): Vec3 {
  return [-FAR, b, 0]
}

describe('профиль плотности', () => {
  it('единица на фотосфере, РОВНО ноль на верхней границе и выше', () => {
    expect(shellDensity(1, H)).toBeCloseTo(1, 12)
    expect(shellDensity(1 + H, H)).toBe(0)
    expect(shellDensity(1 + 2 * H, H)).toBe(0)
  })

  it('монотонно убывает с высотой', () => {
    const samples: number[] = [1, 1.05, 1.1, 1.2, 1.29].map((r: number) => shellDensity(r, H))

    samples.forEach((value: number, i: number) => {
      if (i > 0) expect(value).toBeLessThan(samples[i - 1])
    })
  })
})

describe('оптическая толща', () => {
  it('луч мимо оболочки даёт ровно ноль', () => {
    expect(shellOpticalDepth(ray(1 + H + 0.01), TOWARDS, H)).toBe(0)
  })

  it('снаружи лимба толща монотонно падает с прицельным параметром', () => {
    const samples: number[] = [1.001, 1.05, 1.1, 1.2, 1.29].map((b: number) => shellOpticalDepth(ray(b), TOWARDS, H))

    samples.forEach((value: number, i: number) => {
      if (i > 0) expect(value).toBeLessThan(samples[i - 1])
    })
  })

  it('луч в центр диска обрезается фотосферой', () => {
    const clipped: number = shellOpticalDepth(ray(0), TOWARDS, H)
    const through: number = shellOpticalDepth(ray(0), TOWARDS, H, false)

    expect(clipped).toBeGreaterThan(0)
    expect(clipped).toBeLessThan(through)
  })

  it('центр диска заметно прозрачнее касательного луча', () => {
    const centre: number = shellOpticalDepth(ray(0), TOWARDS, H)
    const tangent: number = shellOpticalDepth(ray(1), TOWARDS, H, false)

    expect(centre / tangent).toBeLessThan(0.3)
  })

  it('камера внутри оболочки: толща непрерывна на её границе', () => {
    const outside: number = shellOpticalDepth([-(1 + H) - 1e-4, 0, 0], TOWARDS, H)
    const inside: number = shellOpticalDepth([-(1 + H) + 1e-4, 0, 0], TOWARDS, H)

    expect(inside).toBeCloseTo(outside, 3)
  })
})

describe('нормировка ручки плотности', () => {
  it('atmosphereDensity — это толща касательного луча, при любой протяжённости', () => {
    for (const h of [0.05, 0.3, 1]) {
      const scale: number = shellDensityScale(h, 1.7)

      expect(scale * shellOpticalDepth(ray(1), TOWARDS, h, false)).toBeCloseTo(1.7, 10)
    }
  })

  it('нулевая плотность даёт нулевой масштаб — точка отката', () => {
    expect(shellDensityScale(H, 0)).toBe(0)
  })
})

describe('константы интеграла', () => {
  it('зафиксированы', () => {
    expect(SHELL_STEPS).toBe(8)
    expect(SHELL_SCALE_FRACTION).toBe(0.25)
  })
})
