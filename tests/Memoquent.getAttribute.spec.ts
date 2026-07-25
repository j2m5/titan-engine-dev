import { describe, it, expect, expectTypeOf } from 'vitest'
import { Model } from '@/core/framework/Memoquent/Model'

interface IRow {
  id: number
  name: string
  count: number
  flag: boolean
  note: string
  nullable: string | null
}

class Row extends Model<IRow> {
  protected table: string = 'rows'
}

describe('getAttribute — falsy-значения не подменяются дефолтом', () => {
  it('нулевое число возвращается как есть, а не как дефолт', () => {
    const row = new Row({ count: 0 })

    expect(row.getAttribute('count', 42)).toBe(0)
  })

  it('пустая строка возвращается как есть', () => {
    const row = new Row({ note: '' })

    expect(row.getAttribute('note', 'дефолт')).toBe('')
  })

  it('false возвращается как есть', () => {
    const row = new Row({ flag: false })

    expect(row.getAttribute('flag', true)).toBe(false)
  })

  it('null подменяется дефолтом (?? срабатывает на null)', () => {
    const row = new Row({ nullable: null })

    expect(row.getAttribute('nullable', 'дефолт')).toBe('дефолт')
  })
})

describe('getAttribute — отсутствующий ключ', () => {
  it('без дефолта возвращает undefined, а не сентинел', () => {
    const row = new Row({})

    expect(row.getAttribute('name')).toBeUndefined()
  })

  it('с дефолтом возвращает дефолт', () => {
    const row = new Row({})

    expect(row.getAttribute('name', 'по умолчанию')).toBe('по умолчанию')
  })
})

describe('getAttribute — типы', () => {
  it('без дефолта тип включает undefined, с дефолтом — нет', () => {
    const row = new Row({ id: 1 })

    expectTypeOf(row.getAttribute('id')).toEqualTypeOf<number | undefined>()
    expectTypeOf(row.getAttribute('id', 0)).toEqualTypeOf<number>()
    expectTypeOf(row.getAttribute('name', '')).toEqualTypeOf<string>()

    // @ts-expect-error — дефолт должен совпадать по типу с полем
    row.getAttribute('id', 'строка')
    // @ts-expect-error — несуществующий ключ
    row.getAttribute('nope')

    expect(row.getAttribute('id')).toBe(1)
  })
})
