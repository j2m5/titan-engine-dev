import { describe, expect, it } from 'vitest'
import { validateDatabase, type DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'
import { generateDatabaseFiles } from '@/core/framework/generation/generateDatabaseFiles'
import { shippedSnapshot } from './helpers/shippedSnapshot'

function snapshot(categories: DatabaseSnapshot['categories']): DatabaseSnapshot {
  return {
    categories, actors: [], physicalObjects: [], renderingObjects: [], orbits: [],
    rotationObjects: [], placements: [], resources: [], actorResource: []
  }
}

describe('fixed runtime category contract', () => {
  it.each([
    [1, 'barycenter'], [2, 'blackHole'], [3, 'star'], [4, 'planet'],
    [5, 'atmosphere'], [6, 'ring'], [7, 'nebula'], [8, 'brownDwarf'],
    [9, 'whiteDwarf'], [10, 'giantStar'], [11, 'asteroidBelt'], [12, 'pulsar']
  ] as const)('accepts category %i / %s with a custom display name', (id, alias) => {
    expect(validateDatabase(snapshot([{ id, alias, name: 'Custom name' }])).ok).toBe(true)
  })

  it.each([
    [13, 'planet'], [4, 'star'], [1, 'planet'], [0, 'barycenter'],
    [4, 'unknown'], [4, 'toString'], [4, 'constructor'], [4, '__proto__'],
    [4, null], [4, undefined], [4, 4], [4, ['planet']], [4, { toString: null }], ['4', 'planet']
  ])('rejects unsupported category pair %j / %j without throwing', (id, alias) => {
    const db = snapshot([{ id, alias, name: 'Invalid' }] as never)
    db.actors.push({ id: 1, categoryId: id as number, parentId: null, name: 'Body', description: '', color: '#fff' })
    const result = validateDatabase(db)

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ collection: 'categories', entity: id }))
  })

  it.each(['new ID', 'changed alias'])('refuses generation after assigning an incompatible category: %s', async (change) => {
    const original = await shippedSnapshot()
    const db = {
      ...original,
      categories: original.categories.map((row) => ({ ...row })),
      actors: original.actors.map((row) => ({ ...row }))
    }
    if (change === 'new ID') {
      db.categories.push({ id: 13, alias: 'planet', name: 'New Category' })
      db.actors = db.actors.map((row) => row.id === 5 ? { ...row, categoryId: 13 } : row)
    } else {
      db.categories = db.categories.map((row) => row.id === 4 ? { ...row, alias: 'star' as const } : row)
    }

    expect(() => generateDatabaseFiles(db)).toThrow(/categories#/)
  })
})
