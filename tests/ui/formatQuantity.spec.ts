import { AU } from '@/core/constants'
import {
  formatAngle,
  formatDistanceKm,
  formatNumber,
  formatOrbitalPeriod,
  formatRotationPeriod,
  formatSemiMajorAxis,
  formatWithUnit
} from '@/ui/components/common/bodyInfo/formatQuantity'

describe('formatNumber: три значащих, большие и малые — мантисса × 10ⁿ', () => {
  it.each([
    [0, '0'],
    [9.856, '9.86'],
    [11.197, '11.2'],
    [655.72, '656'],
    [0.0167, '0.0167'],
    [6360, '6,360'],
    [69911, '69,911'],
    [5.9736e24, '5.97 × 10²⁴'],
    [7.9564e36, '7.96 × 10³⁶'],
    [9.2e-6, '9.20 × 10⁻⁶'],
    [9.996e6, '1.00 × 10⁷'],
    [NaN, '—']
  ])('%s → %s', (value: number, expected: string) => {
    expect(formatNumber(value)).toBe(expected)
  })

  it('единица через пробел', () => {
    expect(formatWithUnit(9.856, 'm/s²')).toBe('9.86 m/s²')
  })
})

describe('единицы по величине', () => {
  it('расстояние: км до 0.01 а.е., а.е. до 10 000 а.е., дальше св. годы', () => {
    expect(formatDistanceKm(1000)).toBe('1,000 km')
    expect(formatDistanceKm(1.5 * AU)).toBe('1.5 AU')
    expect(formatDistanceKm(127000 * AU)).toBe('2.01 ly')
  })

  it('вращение: пульсар в мс, Земля в часах, Луна в сутках', () => {
    expect(formatRotationPeriod(9.2e-6)).toBe('33.1 ms')
    expect(formatRotationPeriod(23.93)).toBe('23.9 h')
    expect(formatRotationPeriod(655.72)).toBe('27.3 d')
  })

  it('орбитальный период: до двух лет в сутках, дальше годы (Седна)', () => {
    expect(formatOrbitalPeriod(686.98)).toBe('687 d')
    expect(formatOrbitalPeriod(4160098)).toBe('11,390 yr')
  })

  it('полуось: у лун в км, у планет в а.е.; угол — со значком градуса', () => {
    expect(formatSemiMajorAxis(0.00257)).toBe(`${formatNumber(0.00257 * AU)} km`)
    expect(formatSemiMajorAxis(1.5236)).toBe('1.52 AU')
    expect(formatAngle(23.44)).toBe('23.4°')
  })
})
