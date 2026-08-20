import { describe, expect, it } from 'vitest'
import { Actor } from '@/core/models/Actor'
import { atmosphericHeightPaths } from '@/Application'

/**
 * Отбор на РЕАЛЬНОЙ БД, а не на стабах: стаб доказывает форму запроса, но не
 * то, что в базе действительно ровно эти тела. Список явный — новое тело с
 * атмосферой и картой высот обязано попасть сюда сознательно (лишний запрос
 * заголовка на старте сценария стоит сети, пропущенное тело — мёртвой
 * подгонки дна атмосферы).
 */
describe('atmosphericHeightPaths на реальной БД', () => {
  it('тела с дочерней атмосферой И картой высот — восемь, явным списком', () => {
    expect(atmosphericHeightPaths(Actor.all()).sort()).toEqual(
      [
        'planets/venus/venus_height.raw', // 6 Venus
        'planets/earth/earth_height.raw', // 7 Earth
        'planets/mars/mars_height.raw', // 8 Mars
        'planets/titan/titan_height.raw', // 29 Titan
        'planets/StarWars/tatooine/tatooine_height.raw', // 62 Tatooine
        'planets/StarWars/adriana3/adriana3_height.raw', // 73 Adriana III
        'planets/StarWars/yavin/iv/yavin4_height.raw', // 83 Yavin IV
        'planets/StarWars/korriban/korriban_height.raw' // 88 Korriban
      ].sort()
    )
  })

  it('тело с картой высот, но без атмосферы, в набор не попадает (Луна)', () => {
    // Контроль дискриминации: карт высот в БД полсотни, атмосфер — единицы.
    expect(atmosphericHeightPaths(Actor.all())).not.toContain('planets/moon/moon_height.raw')
  })

  it('газовый гигант с атмосферой без карты высот в набор не попадает (Юпитер)', () => {
    const jupiter: Actor = Actor.find(10)!

    expect(jupiter.children.where('categoryId', 5).isNotEmpty()).toBe(true)
    expect(atmosphericHeightPaths([jupiter])).toEqual([])
  })
})
