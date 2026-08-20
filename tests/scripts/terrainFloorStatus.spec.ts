import { describe, expect, it } from 'vitest'
import { terrainFloorStatus } from '../../scripts/lib/terrainFloorStatus'

describe('terrainFloorStatus: сверка объявленного пола рельефа с картой', () => {
  it('сходится — ок, и объявленное значение возвращается как есть', () => {
    expect(terrainFloorStatus(-8174.25, -8174.25)).toEqual({ status: 'ok', expected: -8174.25, declared: -8174.25 })
  })

  it('не объявлено — missing с числом, которое надо поставить', () => {
    expect(terrainFloorStatus(undefined, -8174.25)).toEqual({
      status: 'missing',
      expected: -8174.25,
      declared: undefined
    })
  })

  it.each([
    ['NaN', NaN],
    ['числовая строка', '-8174.25'],
    ['null', null]
  ])('нечисловое объявление (%s) — тоже missing, а не тихое совпадение', (_label, declared) => {
    expect(terrainFloorStatus(declared, -8174.25).status).toBe('missing')
  })

  it('разошлось больше метра — mismatch с обоими числами', () => {
    expect(terrainFloorStatus(-8000, -8174.25)).toEqual({ status: 'mismatch', expected: -8174.25, declared: -8000 })
  })

  it('разница в пределах метра — ок: границы карты лежат в заголовке как f32, а в БД вбито округлённое', () => {
    expect(terrainFloorStatus(-8174, -8174.25).status).toBe('ok')
  })

  it('карта целиком выше опорной сферы — ожидается ноль, и объявленный ноль сходится', () => {
    expect(terrainFloorStatus(0, 120)).toEqual({ status: 'ok', expected: 0, declared: 0 })
  })

  it('карта целиком выше опорной сферы, но пол объявлен отрицательным — mismatch', () => {
    expect(terrainFloorStatus(-500, 120).status).toBe('mismatch')
  })
})
