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

describe('terrainFloorStatus: уровень воды поднимает ожидаемый пол', () => {
  it('Земля: дно океана −10533.9, уровень 0 — ожидается 0, дно под водой атмосфере не видно', () => {
    expect(terrainFloorStatus(0, -10533.9, 0)).toEqual({ status: 'ok', expected: 0, declared: 0 })
  })

  it('Явин IV: дно −18941.1, уровень −667.2 — ожидается уровень воды', () => {
    expect(terrainFloorStatus(-667.2, -18941.1, -667.2)).toEqual({ status: 'ok', expected: -667.2, declared: -667.2 })
  })

  it('объявлено дно океана при заданном уровне воды — mismatch, поднять до уровня', () => {
    expect(terrainFloorStatus(-10533.9, -10533.9, 0)).toEqual({ status: 'mismatch', expected: 0, declared: -10533.9 })
  })

  it('уровень воды выше нуля не поднимает пол выше датума', () => {
    expect(terrainFloorStatus(0, -300, 50).expected).toBe(0)
  })

  it('уровень воды ниже минимума карты — минимум карты как есть', () => {
    expect(terrainFloorStatus(-8174.25, -8174.25, -9000).expected).toBe(-8174.25)
  })

  it('без уровня воды (undefined / не число) — прежнее поведение, минимум карты', () => {
    expect(terrainFloorStatus(-8174.25, -8174.25, undefined).expected).toBe(-8174.25)
    expect(terrainFloorStatus(-8174.25, -8174.25, NaN).expected).toBe(-8174.25)
  })
})
