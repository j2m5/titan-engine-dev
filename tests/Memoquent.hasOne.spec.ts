import { beforeEach, describe, expect, it } from 'vitest'
import { Model } from '@/core/framework/Memoquent/Model'
import type { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'

type RelationKey = number | string | null
interface OwnerRow {
  id: RelationKey
  slug: string
}
interface PartRow {
  id: number
  ownerId?: RelationKey
  ownerSlug?: string
  name: string
}

let parts: PartRow[]
let materialized: number[]

class Part extends Model<PartRow> {
  protected table = 'parts'

  public constructor(attributes: Partial<PartRow> = {}) {
    super(attributes)
    if (attributes.id !== undefined) materialized.push(attributes.id)
  }

  public override source(): PartRow[] {
    return parts
  }
}

class Owner extends Model<OwnerRow> {
  protected table = 'owners'

  public get part(): Part | null {
    return this.hasOne(Part, { foreignKey: 'ownerId' })
  }

  public get partBySlug(): Part | null {
    return this.hasOne(Part, { foreignKey: 'ownerSlug', ownerKey: 'slug' })
  }

  public get parts(): ModelCollection<Part> {
    return this.hasMany(Part, { foreignKey: 'ownerId' })
  }
}

class SlugOwner extends Owner {
  protected primaryKey = 'slug'
}

describe('hasOne — первая связанная запись', () => {
  beforeEach(() => {
    parts = []
    materialized = []
  })

  it('прекращает чтение таблицы после первого совпадения', () => {
    let laterReads = 0
    parts = [
      { id: 1, ownerId: 99, name: 'Other owner' },
      { id: 2, ownerId: 7, name: 'First' },
      {
        id: 3,
        get ownerId() {
          laterReads++
          return 7
        },
        name: 'Later'
      }
    ]

    expect(new Owner({ id: 7 }).part?.getAttribute('name')).toBe('First')
    expect(laterReads).toBe(0)
  })

  it('создаёт только первую модель, даже если совпадений несколько', () => {
    parts = [
      { id: 1, ownerId: 7, name: 'First' },
      { id: 2, ownerId: 7, name: 'Later' }
    ]

    expect(new Owner({ id: 7 }).part?.getAttribute('id')).toBe(1)
    expect(materialized).toEqual([1])
  })

  it('сравнивает внешний ключ связанной записи с ключом владельца строго', () => {
    parts = [
      { id: 1, ownerId: '7', name: 'String key' },
      { id: 7, ownerId: 99, name: 'Unrelated matching id' },
      { id: 3, ownerId: 7, name: 'Number key' }
    ]

    expect(new Owner({ id: 7 }).part?.getAttribute('id')).toBe(3)
    expect(new Owner({ id: '7' }).part?.getAttribute('id')).toBe(1)
  })

  it.each([0, '', null])('не отбрасывает заданный falsy-ключ %s', (key) => {
    parts = [{ id: 1, ownerId: key, name: 'Matched' }]
    expect(new Owner({ id: key }).part?.getAttribute('name')).toBe('Matched')
  })

  it('владелец без ключа не связывается с записью без внешнего ключа', () => {
    parts = [{ id: 1, name: 'Missing owner' }]
    expect(new Owner().part).toBeNull()
    expect(materialized).toEqual([])
  })

  it('возвращает null при пустой таблице и отсутствии совпадения', () => {
    const owner = new Owner({ id: 7 })
    expect(owner.part).toBeNull()
    parts = [{ id: 1, ownerId: 99, name: 'Other owner' }]
    expect(owner.part).toBeNull()
  })

  it('явный ownerKey берётся из владельца, foreignKey — из связанной записи', () => {
    parts = [
      { id: 1, ownerId: 7, ownerSlug: 'other', name: 'Other slug' },
      { id: 2, ownerId: 99, ownerSlug: 'earth', name: 'Earth' }
    ]
    expect(new Owner({ id: 7, slug: 'earth' }).partBySlug?.getAttribute('id')).toBe(2)
  })

  it('использует нестандартный primaryKey владельца по умолчанию', () => {
    parts = [
      { id: 1, ownerId: 7, name: 'Numeric id' },
      { id: 2, ownerId: 'earth', name: 'Slug key' }
    ]
    expect(new SlugOwner({ id: 7, slug: 'earth' }).part?.getAttribute('id')).toBe(2)
  })

  it('повторное чтение видит замену, удаление и добавление связанных данных', () => {
    const owner = new Owner({ id: 7 })
    parts = [{ id: 1, ownerId: 7, name: 'Before' }]
    const previous = owner.part!
    parts = [{ id: 2, ownerId: 7, name: 'After' }]
    expect(owner.part?.getAttribute('name')).toBe('After')
    expect(previous.getAttribute('name')).toBe('Before')
    parts = []
    expect(owner.part).toBeNull()
    parts = [{ id: 3, ownerId: 8, name: 'New owner' }]
    owner.setAttribute('id', 8)
    expect(owner.part?.getAttribute('name')).toBe('New owner')
  })

  it('hasMany продолжает возвращать все совпадения в порядке таблицы', () => {
    parts = [
      { id: 3, ownerId: 7, name: 'First' },
      { id: 1, ownerId: 99, name: 'Other' },
      { id: 2, ownerId: 7, name: 'Second' }
    ]
    expect(new Owner({ id: 7 }).parts.pluck('id')).toEqual([3, 2])
  })
})
