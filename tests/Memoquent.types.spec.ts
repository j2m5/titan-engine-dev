import { describe, it, expect, expectTypeOf } from 'vitest'
import { Model } from '@/core/framework/Memoquent/Model'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'
import { Collection } from '@/core/framework/support/Collection'
import { RelationKeys } from '@/core/framework/Memoquent/QueryBuilder'

interface IThing {
  id: number
  label: string
  weight: number
}

const THINGS: IThing[] = [
  { id: 2, label: 'b', weight: 20 },
  { id: 1, label: 'a', weight: 10 }
]

interface IPart {
  id: number
  thingId: number
  name: string
}

const PARTS: IPart[] = [
  { id: 1, thingId: 2, name: 'bolt' },
  { id: 2, thingId: 2, name: 'nut' }
]

class Part extends Model<IPart> {
  protected table: string = 'parts'

  public override source(): IPart[] {
    return PARTS
  }
}

class Thing extends Model<IThing> {
  protected table: string = 'things'

  public override source(): IThing[] {
    return THINGS
  }

  /**
   * Связь-коллекция нужна фикстуре не для красоты: без нее
   * RelationKeys<Thing> вырождается в never, и негативные проверки
   * whereHas проходили бы просто потому, что параметр никакой строки не
   * принимает — регресс нижней границы (ModelCollection<never>) остался бы
   * незамеченным.
   */
  public get parts(): ModelCollection<Part> {
    return this.hasMany(Part, { foreignKey: 'thingId' })
  }
}

/**
 * Отдельная фикстура под негативную проверку внешнего ключа. Добавить
 * typoParts в Thing нельзя: RelationKeys<Thing> перестал бы равняться
 * 'parts', и проверка нижней границы в whereHas потеряла бы смысл.
 */
class ThingWithRelations extends Model<IThing> {
  protected table: string = 'things'

  public override source(): IThing[] {
    return THINGS
  }

  public get parts(): ModelCollection<Part> {
    return this.hasMany(Part, { foreignKey: 'thingId' })
  }

  public get typoParts(): ModelCollection<Part> {
    // @ts-expect-error — 'thingID' отсутствует в IPart
    return this.hasMany(Part, { foreignKey: 'thingID' })
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

describe('QueryBuilder — типизация связей и полей', () => {
  it('whereHas принимает только реальные связи', () => {
    // Позитивная проверка обязательна: она ловит регресс нижней границы в
    // RelationKeys. С ModelCollection<never> вместо ModelCollection<Model<object>>
    // ключ 'parts' выпадает из типа, RelationKeys<Thing> становится never, и
    // одни только @ts-expect-error ниже остались бы зелеными.
    expectTypeOf<RelationKeys<Thing>>().toEqualTypeOf<'parts'>()

    // @ts-expect-error — 'label' это атрибут, а не связь
    Thing.query().whereHas('label')
    // @ts-expect-error — 'nope' не существует
    Thing.query().whereHas('nope')

    // связь резолвится и в рантайме: детали есть только у Thing #2
    expect(Thing.query().whereHas('parts').get().pluck('id')).toEqual([2])
    expect(Thing.query().whereDoesntHave('parts').get().pluck('id')).toEqual([1])
    expect(Thing.query().count()).toBe(2)
  })

  it('whereIn проверяет тип значений по полю', () => {
    // @ts-expect-error — id это number, строки недопустимы
    Thing.query().whereIn('id', ['1'])

    expect(Thing.query().whereIn('id', [1]).count()).toBe(1)
  })

  it('pluck на билдере выводит тип поля', () => {
    expectTypeOf(Thing.query().pluck('weight')).toEqualTypeOf<(number | undefined)[]>()
  })
})

describe('Model — типизация внешних ключей и аксессоров', () => {
  it('hasMany требует ключ связанной модели', () => {
    // детали в PARTS привязаны к thingId: 2, поэтому фикстура берет Thing #2
    const thing = new ThingWithRelations({ id: 2, label: 'b', weight: 20 })

    expect(thing.parts.count()).toBe(2)
  })

  it('toJSON возвращает частичную форму данных', () => {
    const thing = new ThingWithRelations({ id: 1, label: 'a', weight: 10 })

    expectTypeOf(thing.toJSON()).toEqualTypeOf<Partial<IThing>>()
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
