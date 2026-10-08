import { Actor } from '@/core/models/Actor'
import { primaryOf } from '@/core/bodyInfo/primaryOf'

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
