import { Actor } from '@/core/models/Actor'
import { primaryOf } from '@/core/bodyInfo/primaryOf'
import { relativeSpeedKms } from '@/core/bodyInfo/worldVelocity'

const nameOf = (id: number): string | null => primaryOf(Actor.find(id)!)?.getAttribute('name') ?? null

describe('primaryOf: вокруг чего тело обращается по смыслу', () => {
  it('Луна → Земля: в барицентре Земля–Луна главное — самое массивное тело', () => {
    expect(nameOf(19)).toBe('Earth')
  })

  it('Земля → Солнце: сама главная в своём барицентре — уровнем выше', () => {
    expect(nameOf(7)).toBe('Sun')
  })

  it('Юпитер → Солнце: среди детей барицентра Солнечной системы Солнце тяжелее', () => {
    expect(nameOf(10)).toBe('Sun')
  })

  it('Харон → Плутон, Плутон → Солнце', () => {
    expect(nameOf(37)).toBe('Pluto')
    expect(nameOf(14)).toBe('Sun')
  })

  it('Марс → Солнце: родитель — звезда, не барицентр', () => {
    expect(nameOf(8)).toBe('Sun')
  })

  it('Солнце → нет; Tatoo II → Tatoo I; Tatoo I → нет', () => {
    expect(nameOf(4)).toBeNull()
    expect(nameOf(61)).toBe('Tatoo I')
    expect(nameOf(60)).toBeNull()
  })
})

describe('primaryOf: двойная звезда — планеты обращаются вокруг барицентра пары', () => {
  // Tatoo I — 61 % массы системы: не доминирует и пары с планетами не образует
  it.each([62, 63, 64])('планета %i (Tatooine, Ohann, Adriana) → Tatoo system barycenter', (id: number) => {
    expect(nameOf(id)).toBe('Tatoo system barycenter')
  })

  it('скорость Tatooine относительно главного тела ровная, а не качается с периодом пары (40.8 сут)', () => {
    const tatooine = Actor.find(62)!
    const primary = primaryOf(tatooine)!
    const speeds = [0, 10, 20, 30].map((days: number) => relativeSpeedKms(tatooine, primary, 2451545 + days))

    expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(1)
  })
})
