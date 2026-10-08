import { Actor } from '@/core/models/Actor'
import { KeplerianModel } from '@/core/libs/KeplerianModel'

/**
 * Орбиты Солнечной системы — элементы JPL Horizons (эклиптика J2000, TDB
 * 2461222.5). Внутренние планеты и Церера обращаются вокруг Солнца
 * гелиоцентрическими элементами: оскулирующие элементы относительно
 * барицентра у них искажены смещением Солнца (у Венеры e вдвое, у барицентра
 * Земля–Луна перигелий на ~10°, полуось Меркурия на 2 %). Гигантам и дальше
 * барицентр — правильный центр.
 */

const SUN_ID = 4
const SOLAR_BARYCENTER_ID = 1
const HELIOCENTRIC = [5, 6, 2, 8, 9] // Меркурий, Венера, барицентр Земля–Луна, Марс, Церера
const BARYCENTRIC = [10, 11, 12, 13, 3, 15, 16, 17, 18] // гиганты, барицентр Плутона, ТНО

function semiMajorAxisDeviation(id: number): number {
  const k = new KeplerianModel(Actor.find(id)!)
  const aKepler = Math.cbrt(k.mu * (k.period / (2 * Math.PI)) ** 2)

  return Math.abs(k.semiMajorAxis / aKepler - 1)
}

describe('Орбиты Солнечной системы', () => {
  it.each(HELIOCENTRIC)('тело %i обращается вокруг Солнца', (id: number) => {
    expect(Actor.find(id)!.getAttribute('parentId')).toBe(SUN_ID)
  })

  it.each(BARYCENTRIC)('тело %i обращается вокруг барицентра Солнечной системы', (id: number) => {
    expect(Actor.find(id)!.getAttribute('parentId')).toBe(SOLAR_BARYCENTER_ID)
  })

  it.each([...HELIOCENTRIC, ...BARYCENTRIC])(
    'тело %i: полуось согласована с явным периодом по третьему закону Кеплера (0.1 %)',
    (id: number) => {
      expect(semiMajorAxisDeviation(id)).toBeLessThan(1e-3)
    }
  )
})
