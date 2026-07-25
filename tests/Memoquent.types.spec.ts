import { describe, it, expect, expectTypeOf } from 'vitest'
import { Model } from '@/core/framework/Memoquent/Model'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { Collection } from '@/core/framework/support/Collection'

interface IThing {
  id: number
  label: string
  weight: number
}

const THINGS: IThing[] = [
  { id: 2, label: 'b', weight: 20 },
  { id: 1, label: 'a', weight: 10 }
]

class Thing extends Model<IThing> {
  protected table: string = 'things'

  public override source(): IThing[] {
    return THINGS
  }
}

describe('ModelCollection — типизация ключей', () => {
  it('pluck выводит тип значения атрибута', () => {
    const collection = new ModelCollection(THINGS.map((t) => new Thing(t)))

    expectTypeOf(collection.pluck('id')).toEqualTypeOf<(number | undefined)[]>()
    expectTypeOf(collection.pluck('label')).toEqualTypeOf<(string | undefined)[]>()

    expect(collection.pluck('id')).toEqual([2, 1])
  })

  it('несуществующий ключ не компилируется', () => {
    const collection = new ModelCollection(THINGS.map((t) => new Thing(t)))

    // @ts-expect-error — 'nope' отсутствует в IThing
    collection.pluck('nope')
    // @ts-expect-error — 'nope' отсутствует в IThing
    collection.sortBy('nope')

    expect(collection.count()).toBe(2)
  })

  it('sortBy принимает ключ атрибута и сохраняет тип коллекции', () => {
    const collection = new ModelCollection(THINGS.map((t) => new Thing(t)))
    const sorted = collection.sortBy('id')

    expectTypeOf(sorted).toEqualTypeOf<ModelCollection<Thing>>()
    expect(sorted.pluck('id')).toEqual([1, 2])
  })

  it('sum/avg принимают только числовые ключи', () => {
    const collection = new ModelCollection(THINGS.map((t) => new Thing(t)))

    expect(collection.sum('weight')).toBe(30)
    // @ts-expect-error — 'label' не числовое поле
    collection.sum('label')
  })
})

describe('Collection — типизация над плоским объектом', () => {
  it('ключи выводятся из T, когда TShape не задан', () => {
    const collection = new Collection<IThing>(THINGS)

    expectTypeOf(collection.pluck('label')).toEqualTypeOf<(string | undefined)[]>()
    // @ts-expect-error — 'nope' отсутствует в IThing
    collection.pluck('nope')

    expect(collection.pluck('label')).toEqual(['b', 'a'])
  })
})
