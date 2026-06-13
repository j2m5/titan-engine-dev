import { describe, it, expect, afterAll } from 'vitest'
import { Model } from '@/core/framework/Memoquent/Model'
import { Scope } from '@/core/framework/Memoquent/Scope'

/**
 * Тестовая модель-фикстура. Memoquent читает данные через source(),
 * поэтому достаточно переопределить его статичным массивом —
 * никакой реальной БД для тестов QueryBuilder не нужно.
 */
interface UserData {
  id: number
  name: string
  role: 'admin' | 'editor' | 'viewer'
  age: number
  deletedAt: string | null
}

const USERS: UserData[] = [
  { id: 1, name: 'Alice', role: 'admin', age: 30, deletedAt: null },
  { id: 2, name: 'Bob', role: 'editor', age: 25, deletedAt: null },
  { id: 3, name: 'Carol', role: 'editor', age: 41, deletedAt: '2024-01-01' },
  { id: 4, name: 'Dave', role: 'viewer', age: 19, deletedAt: null },
  { id: 5, name: 'Erin', role: 'viewer', age: 55, deletedAt: null }
]

class User extends Model<UserData> {
  protected table: string = 'users'
  protected primaryKey = 'id'

  public source(): UserData[] {
    return USERS
  }
}

/** Глобальный скоуп: скрывает "удаленные" записи (deletedAt !== null) */
class NotDeletedScope implements Scope<UserData, User> {
  public apply(builder: any): void {
    builder.whereNull('deletedAt')
  }
}

describe('QueryBuilder — фильтрация', () => {
  it('where сужает по точному совпадению', () => {
    const result = User.query().where({ role: 'editor' }).get()

    expect(result.pluck('id' as any)).toEqual([2, 3])
  })

  it('whereIn включает только перечисленные значения', () => {
    const result = User.query().whereIn('role', ['admin', 'viewer']).get()

    expect(result.pluck('id' as any).sort()).toEqual([1, 4, 5])
  })

  it('whereNotIn исключает перечисленные значения', () => {
    const result = User.query().whereNotIn('role', ['viewer']).get()

    expect(result.pluck('id' as any).sort()).toEqual([1, 2, 3])
  })

  it('whereBetween включает границы диапазона', () => {
    const result = User.query().whereBetween('age', [25, 41]).get()

    expect(result.pluck('id' as any).sort()).toEqual([1, 2, 3])
  })

  it('whereNull / whereNotNull по nullable-полю', () => {
    expect(
      User.query()
        .whereNotNull('deletedAt')
        .get()
        .pluck('id' as any)
    ).toEqual([3])
    expect(
      User.query()
        .whereNull('deletedAt')
        .get()
        .pluck('id' as any)
        .sort()
    ).toEqual([1, 2, 4, 5])
  })

  it('комбинирует несколько условий через AND', () => {
    const result = User.query().whereIn('role', ['editor', 'viewer']).whereBetween('age', [20, 50]).get()

    // editor/viewer И возраст 20..50 => Bob(25), Carol(41)
    expect(result.pluck('id' as any).sort()).toEqual([2, 3])
  })
})

describe('QueryBuilder — баг #1: count() учитывает ВСЕ фильтры', () => {
  it('count() с whereIn совпадает с длиной get()', () => {
    const query = () => User.query().whereIn('role', ['admin'])

    expect(query().count()).toBe(1)
    expect(query().count()).toBe(query().get().count())
  })

  it('count() с whereBetween не равен общему числу записей', () => {
    const query = () => User.query().whereBetween('age', [18, 26])

    // Bob(25), Dave(19) => 2, а НЕ 5
    expect(query().count()).toBe(2)
  })

  it('count() с несколькими фильтрами согласован с get()', () => {
    const query = () => User.query().whereNotIn('role', ['admin']).whereBetween('age', [20, 60])

    expect(query().count()).toBe(query().get().count())
  })
})

describe('QueryBuilder — баг #2: limit(0) возвращает пустую коллекцию', () => {
  it('limit(0) => 0 записей (а не все)', () => {
    expect(User.query().limit(0).get().count()).toBe(0)
  })

  it('limit(2) ограничивает выборку', () => {
    expect(
      User.query()
        .orderBy('id')
        .limit(2)
        .get()
        .pluck('id' as any)
    ).toEqual([1, 2])
  })

  it('offset(0) не теряет записи', () => {
    expect(User.query().orderBy('id').offset(0).get().count()).toBe(5)
  })

  it('offset + limit дают окно', () => {
    expect(
      User.query()
        .orderBy('id')
        .offset(1)
        .limit(2)
        .get()
        .pluck('id' as any)
    ).toEqual([2, 3])
  })
})

describe('QueryBuilder — paginate согласован с фильтрами', () => {
  it('total и lastPage считаются по отфильтрованному набору', () => {
    const result = User.query().whereIn('role', ['editor', 'viewer']).paginate(1, 2)

    // editor/viewer => 4 записи, по 2 на страницу => 2 страницы
    expect(result.total).toBe(4)
    expect(result.lastPage).toBe(2)
    expect(result.data.count()).toBe(2)
  })

  it('вторая страница содержит остаток', () => {
    const result = User.query().orderBy('id').paginate(2, 2)

    expect(result.currentPage).toBe(2)
    expect(result.data.pluck('id' as any)).toEqual([3, 4])
  })
})

describe('QueryBuilder — глобальные скоупы', () => {
  // globalScopes статична и переживает между тестами — снимаем после блока,
  // чтобы скоуп не протек в другие describe этого файла.
  afterAll(() => {
    User.getGlobalScopes().delete('not_deleted')
  })

  it('get() уважает глобальный скоуп', () => {
    User.addGlobalScope('not_deleted', new NotDeletedScope())

    // Carol (id:3) "удалена" (deletedAt !== null) — скоуп должен ее скрыть
    expect(
      User.query()
        .get()
        .pluck('id' as any)
    ).not.toContain(3)
  })

  it('count() уважает тот же глобальный скоуп (баг #1 + скоупы)', () => {
    User.addGlobalScope('not_deleted', new NotDeletedScope())

    expect(User.query().count()).toBe(4)
  })

  it('withoutGlobalScope отключает скоуп для конкретного запроса', () => {
    User.addGlobalScope('not_deleted', new NotDeletedScope())

    expect(User.query().withoutGlobalScope('not_deleted').count()).toBe(5)
    expect(
      User.query()
        .withoutGlobalScope('not_deleted')
        .get()
        .pluck('id' as any)
    ).toContain(3)
  })

  it('скоуп комбинируется с пользовательскими фильтрами через AND', () => {
    User.addGlobalScope('not_deleted', new NotDeletedScope())

    // не удалены И editor => только Bob(2); Carol(3) отсеяна скоупом
    expect(
      User.query()
        .where({ role: 'editor' })
        .get()
        .pluck('id' as any)
    ).toEqual([2])
  })
})
