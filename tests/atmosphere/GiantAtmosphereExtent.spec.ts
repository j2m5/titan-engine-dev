import { RenderingObjects, Actors } from '@storage/database'

/**
 * Атмосферы газовых гигантов по рецепту Явин Прайма (аудит дальнего вида,
 * пункт 8): H_R = 0.5% R, оболочка 9.5 шкал высот — видимая полоса ~3%
 * радиуса вместо волосяной линии земной шкалы (20–50 км).
 *
 * Растяжение «той же атмосферы»: все профили ×k по высоте, все
 * коэффициенты /k — вертикальная оптическая толща β·H каждого вещества
 * сохранена, центр диска выглядит как раньше; толща вдоль касательной у
 * лимба падает как √(1/k) — полоса шире и мягче.
 *
 * Прежние значения — снимок данных до растяжения (2026-10-05).
 */

type Layer = { expScale: number }
type Row = {
  id: number
  actorId: number
  data: {
    bottomRadius: number
    topRadius: number
    rayleighDensity: [Layer, Layer]
    mieDensity: [Layer, Layer]
    absorptionDensity: [Layer, Layer]
    rayleighScattering: number[]
    mieExtinction: number[]
    absorptionExtinction: number[]
  }
}

/** ro → [имя, прежний expScale Rayleigh, прежний β_R(синий), прежний expScale Ми, прежний β_Mie ext, прежний expScale поглощения, прежний β_abs(r)] */
const BEFORE: Record<number, [string, number, number, number, number, number, number]> = {
  16: ['Jupiter', -0.04011542245063536, 0.00578765, -0.03333333333333333, 0.0028, 0, 0],
  17: ['Saturn', -0.020052135552436335, 0.0028875, -0.016666666666666666, 0.00291667, 0, 0],
  18: ['Uranus', -0.03705781146575193, 0.0104518, -0.037037037037037035, 0.00111111, -0.03705781146575193, 0.012],
  19: ['Neptune', -0.04861258229381615, 0.0113358, -0.043478260869565216, 0.00173913, -0.04861258229381615, 0.014],
  22: ['TOI-519b', -0.04716981132075472, 0.0127435, -0.05555555555555555, 0.0048, -0.05, 0.008],
  25: ['Ohann', -0.03968253968253968, 0.001655, -0.06666666666666667, 0.0048, 0, 0],
  26: ['Adriana', -0.04716981132075472, 0.00892045, -0.05555555555555555, 0.0042, -0.05, 0.008],
  97: ['Halcyra', -0.03968253968253968, 0.001655, -0.06666666666666667, 0.0048, 0, 0],
  103: ['Thalorn', -0.03968253968253968, 0.001655, -0.06666666666666667, 0.0048, 0, 0]
}

const rowOf = (id: number) => (RenderingObjects as unknown as Row[]).find((r) => r.id === id)!
/** Вертикальная оптическая толща экспоненциального слоя: β · H = β / (−expScale) */
const tau = (beta: number, expScale: number) => beta / -expScale

describe('Газовые гиганты: полоса атмосферы ~3% радиуса', () => {
  it.each(Object.entries(BEFORE).map(([id, v]) => [v[0], Number(id)] as const))('%s: H_R = 0.5% R, оболочка 9.5 H', (_name, id) => {
    const d = rowOf(id).data
    const scaleHeight = -1 / d.rayleighDensity[1].expScale

    expect(scaleHeight / d.bottomRadius).toBeGreaterThan(0.00499)
    expect(scaleHeight / d.bottomRadius).toBeLessThan(0.00501)
    expect((d.topRadius - d.bottomRadius) / scaleHeight).toBeGreaterThan(9.4)
    expect((d.topRadius - d.bottomRadius) / scaleHeight).toBeLessThan(9.6)
  })

  it.each(Object.entries(BEFORE).map(([id, v]) => [v[0], Number(id)] as const))('%s: вертикальная толща каждого вещества сохранена', (_name, id) => {
    const d = rowOf(id).data
    const [, rES, rB, mES, mE, aES, aE] = BEFORE[id]
    const close = (now: number, before: number) => expect(Math.abs(now / before - 1)).toBeLessThan(1e-3)

    close(tau(d.rayleighScattering[2], d.rayleighDensity[1].expScale), tau(rB, rES))
    close(tau(d.mieExtinction[0], d.mieDensity[1].expScale), tau(mE, mES))
    if (aES !== 0) close(tau(d.absorptionExtinction[0], d.absorptionDensity[1].expScale), tau(aE, aES))
    // отношение шкал Ми/Рэлей — то же растяжение, профиль не перекошен
    close(d.mieDensity[1].expScale / d.rayleighDensity[1].expScale, mES / rES)
  })

  it('кольцо гиганта лежит за новой оболочкой', () => {
    type RingRow = { actorId: number; data: { innerRadius?: number } }
    for (const id of Object.keys(BEFORE).map(Number)) {
      const atmosphere = rowOf(id)
      const planetId = Actors.find((a) => a.id === atmosphere.actorId)!.parentId
      const ring = Actors.find((a) => a.parentId === planetId && a.categoryId === 6)
      if (!ring) continue
      const ringRow = (RenderingObjects as unknown as RingRow[]).find((r) => r.actorId === ring.id)!

      expect(ringRow.data.innerRadius!, `ro ${id}`).toBeGreaterThan(atmosphere.data.topRadius)
    }
  })
})
