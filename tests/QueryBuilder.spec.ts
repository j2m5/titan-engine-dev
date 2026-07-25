import { describe, it, expect, afterAll } from 'vitest'
import { Model } from '@/core/framework/Memoquent/Model'
import { Scope } from '@/core/framework/Memoquent/Scope'
import { QueryBuilder } from '@/core/framework/Memoquent/QueryBuilder'

/**
 * РўРµСЃС‚РѕРІР°СЏ РјРѕРґРµР»СЊ-С„РёРєСЃС‚СѓСЂР°. Memoquent С‡РёС‚Р°РµС‚ РґР°РЅРЅС‹Рµ С‡РµСЂРµР· source(),
 * РїРѕСЌС‚РѕРјСѓ РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїРµСЂРµРѕРїСЂРµРґРµР»РёС‚СЊ РµРіРѕ СЃС‚Р°С‚РёС‡РЅС‹Рј РјР°СЃСЃРёРІРѕРј вЂ”
 * РЅРёРєР°РєРѕР№ СЂРµР°Р»СЊРЅРѕР№ Р‘Р” РґР»СЏ С‚РµСЃС‚РѕРІ QueryBuilder РЅРµ РЅСѓР¶РЅРѕ.
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

/** Р“Р»РѕР±Р°Р»СЊРЅС‹Р№ СЃРєРѕСѓРї: СЃРєСЂС‹РІР°РµС‚ "СѓРґР°Р»РµРЅРЅС‹Рµ" Р·Р°РїРёСЃРё (deletedAt !== null) */
class NotDeletedScope implements Scope<UserData, User> {
  public apply(builder: QueryBuilder<UserData, User>): void {
    builder.whereNull('deletedAt')
  }
}

describe('QueryBuilder вЂ” С„РёР»СЊС‚СЂР°С†РёСЏ', () => {
  it('where СЃСѓР¶Р°РµС‚ РїРѕ С‚РѕС‡РЅРѕРјСѓ СЃРѕРІРїР°РґРµРЅРёСЋ', () => {
    const result = User.query().where({ role: 'editor' }).get()

    expect(result.pluck('id')).toEqual([2, 3])
  })

  it('whereIn РІРєР»СЋС‡Р°РµС‚ С‚РѕР»СЊРєРѕ РїРµСЂРµС‡РёСЃР»РµРЅРЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ', () => {
    const result = User.query().whereIn('role', ['admin', 'viewer']).get()

    expect(result.pluck('id').sort()).toEqual([1, 4, 5])
  })

  it('whereNotIn РёСЃРєР»СЋС‡Р°РµС‚ РїРµСЂРµС‡РёСЃР»РµРЅРЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ', () => {
    const result = User.query().whereNotIn('role', ['viewer']).get()

    expect(result.pluck('id').sort()).toEqual([1, 2, 3])
  })

  it('whereBetween РІРєР»СЋС‡Р°РµС‚ РіСЂР°РЅРёС†С‹ РґРёР°РїР°Р·РѕРЅР°', () => {
    const result = User.query().whereBetween('age', [25, 41]).get()

    expect(result.pluck('id').sort()).toEqual([1, 2, 3])
  })

  it('whereNull / whereNotNull РїРѕ nullable-РїРѕР»СЋ', () => {
    expect(
      User.query()
        .whereNotNull('deletedAt')
        .get()
        .pluck('id')
    ).toEqual([3])
    expect(
      User.query()
        .whereNull('deletedAt')
        .get()
        .pluck('id')
        .sort()
    ).toEqual([1, 2, 4, 5])
  })

  it('РєРѕРјР±РёРЅРёСЂСѓРµС‚ РЅРµСЃРєРѕР»СЊРєРѕ СѓСЃР»РѕРІРёР№ С‡РµСЂРµР· AND', () => {
    const result = User.query().whereIn('role', ['editor', 'viewer']).whereBetween('age', [20, 50]).get()

    // editor/viewer Р РІРѕР·СЂР°СЃС‚ 20..50 => Bob(25), Carol(41)
    expect(result.pluck('id').sort()).toEqual([2, 3])
  })
})

describe('QueryBuilder вЂ” Р±Р°Рі #1: count() СѓС‡РёС‚С‹РІР°РµС‚ Р’РЎР• С„РёР»СЊС‚СЂС‹', () => {
  it('count() СЃ whereIn СЃРѕРІРїР°РґР°РµС‚ СЃ РґР»РёРЅРѕР№ get()', () => {
    const query = () => User.query().whereIn('role', ['admin'])

    expect(query().count()).toBe(1)
    expect(query().count()).toBe(query().get().count())
  })

  it('count() СЃ whereBetween РЅРµ СЂР°РІРµРЅ РѕР±С‰РµРјСѓ С‡РёСЃР»Сѓ Р·Р°РїРёСЃРµР№', () => {
    const query = () => User.query().whereBetween('age', [18, 26])

    // Bob(25), Dave(19) => 2, Р° РќР• 5
    expect(query().count()).toBe(2)
  })

  it('count() СЃ РЅРµСЃРєРѕР»СЊРєРёРјРё С„РёР»СЊС‚СЂР°РјРё СЃРѕРіР»Р°СЃРѕРІР°РЅ СЃ get()', () => {
    const query = () => User.query().whereNotIn('role', ['admin']).whereBetween('age', [20, 60])

    expect(query().count()).toBe(query().get().count())
  })
})

describe('QueryBuilder вЂ” Р±Р°Рі #2: limit(0) РІРѕР·РІСЂР°С‰Р°РµС‚ РїСѓСЃС‚СѓСЋ РєРѕР»Р»РµРєС†РёСЋ', () => {
  it('limit(0) => 0 Р·Р°РїРёСЃРµР№ (Р° РЅРµ РІСЃРµ)', () => {
    expect(User.query().limit(0).get().count()).toBe(0)
  })

  it('limit(2) РѕРіСЂР°РЅРёС‡РёРІР°РµС‚ РІС‹Р±РѕСЂРєСѓ', () => {
    expect(
      User.query()
        .orderBy('id')
        .limit(2)
        .get()
        .pluck('id')
    ).toEqual([1, 2])
  })

  it('offset(0) РЅРµ С‚РµСЂСЏРµС‚ Р·Р°РїРёСЃРё', () => {
    expect(User.query().orderBy('id').offset(0).get().count()).toBe(5)
  })

  it('offset + limit РґР°СЋС‚ РѕРєРЅРѕ', () => {
    expect(
      User.query()
        .orderBy('id')
        .offset(1)
        .limit(2)
        .get()
        .pluck('id')
    ).toEqual([2, 3])
  })
})

describe('QueryBuilder вЂ” paginate СЃРѕРіР»Р°СЃРѕРІР°РЅ СЃ С„РёР»СЊС‚СЂР°РјРё', () => {
  it('total Рё lastPage СЃС‡РёС‚Р°СЋС‚СЃСЏ РїРѕ РѕС‚С„РёР»СЊС‚СЂРѕРІР°РЅРЅРѕРјСѓ РЅР°Р±РѕСЂСѓ', () => {
    const result = User.query().whereIn('role', ['editor', 'viewer']).paginate(1, 2)

    // editor/viewer => 4 Р·Р°РїРёСЃРё, РїРѕ 2 РЅР° СЃС‚СЂР°РЅРёС†Сѓ => 2 СЃС‚СЂР°РЅРёС†С‹
    expect(result.total).toBe(4)
    expect(result.lastPage).toBe(2)
    expect(result.data.count()).toBe(2)
  })

  it('РІС‚РѕСЂР°СЏ СЃС‚СЂР°РЅРёС†Р° СЃРѕРґРµСЂР¶РёС‚ РѕСЃС‚Р°С‚РѕРє', () => {
    const result = User.query().orderBy('id').paginate(2, 2)

    expect(result.currentPage).toBe(2)
    expect(result.data.pluck('id')).toEqual([3, 4])
  })
})

describe('QueryBuilder вЂ” РіР»РѕР±Р°Р»СЊРЅС‹Рµ СЃРєРѕСѓРїС‹', () => {
  // globalScopes СЃС‚Р°С‚РёС‡РЅР° Рё РїРµСЂРµР¶РёРІР°РµС‚ РјРµР¶РґСѓ С‚РµСЃС‚Р°РјРё вЂ” СЃРЅРёРјР°РµРј РїРѕСЃР»Рµ Р±Р»РѕРєР°,
  // С‡С‚РѕР±С‹ СЃРєРѕСѓРї РЅРµ РїСЂРѕС‚РµРє РІ РґСЂСѓРіРёРµ describe СЌС‚РѕРіРѕ С„Р°Р№Р»Р°.
  afterAll(() => {
    User.getGlobalScopes().delete('not_deleted')
  })

  it('get() СѓРІР°Р¶Р°РµС‚ РіР»РѕР±Р°Р»СЊРЅС‹Р№ СЃРєРѕСѓРї', () => {
    User.addGlobalScope('not_deleted', new NotDeletedScope())

    // Carol (id:3) "СѓРґР°Р»РµРЅР°" (deletedAt !== null) вЂ” СЃРєРѕСѓРї РґРѕР»Р¶РµРЅ РµРµ СЃРєСЂС‹С‚СЊ
    expect(
      User.query()
        .get()
        .pluck('id')
    ).not.toContain(3)
  })

  it('count() СѓРІР°Р¶Р°РµС‚ С‚РѕС‚ Р¶Рµ РіР»РѕР±Р°Р»СЊРЅС‹Р№ СЃРєРѕСѓРї (Р±Р°Рі #1 + СЃРєРѕСѓРїС‹)', () => {
    User.addGlobalScope('not_deleted', new NotDeletedScope())

    expect(User.query().count()).toBe(4)
  })

  it('withoutGlobalScope РѕС‚РєР»СЋС‡Р°РµС‚ СЃРєРѕСѓРї РґР»СЏ РєРѕРЅРєСЂРµС‚РЅРѕРіРѕ Р·Р°РїСЂРѕСЃР°', () => {
    User.addGlobalScope('not_deleted', new NotDeletedScope())

    expect(User.query().withoutGlobalScope('not_deleted').count()).toBe(5)
    expect(
      User.query()
        .withoutGlobalScope('not_deleted')
        .get()
        .pluck('id')
    ).toContain(3)
  })

  it('СЃРєРѕСѓРї РєРѕРјР±РёРЅРёСЂСѓРµС‚СЃСЏ СЃ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёРјРё С„РёР»СЊС‚СЂР°РјРё С‡РµСЂРµР· AND', () => {
    User.addGlobalScope('not_deleted', new NotDeletedScope())

    // РЅРµ СѓРґР°Р»РµРЅС‹ Р editor => С‚РѕР»СЊРєРѕ Bob(2); Carol(3) РѕС‚СЃРµСЏРЅР° СЃРєРѕСѓРїРѕРј
    expect(
      User.query()
        .where({ role: 'editor' })
        .get()
        .pluck('id')
    ).toEqual([2])
  })
})
