import { describe, it, expect } from 'vitest'
import { validateDatabase, DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'

/** Минимальный снимок: барицентр, планета с орбитой, туманность-ребёнок планеты */
function snapshot(placement: Record<string, unknown>, parentHasOrbit = true): DatabaseSnapshot {
  return {
    categories: [
      { id: 1, alias: 'barycenter', name: 'Barycenter' },
      { id: 4, alias: 'planet', name: 'Planet' },
      { id: 7, alias: 'nebula', name: 'Nebula' }
    ],
    actors: [
      { id: 1, categoryId: 1, parentId: null, name: 'Root', description: '', color: '#fff' },
      { id: 2, categoryId: 4, parentId: 1, name: 'Planet', description: '', color: '#fff' },
      { id: 3, categoryId: 7, parentId: 2, name: 'L4 cloud', description: '', color: '#fff' }
    ],
    orbits: parentHasOrbit
      ? [
          {
            id: 1,
            actorId: 2,
            semiMajorAxis: 18,
            eccentricity: 0,
            inclination: 0,
            argOfPeriapsis: 0,
            ascendingNode: 0,
            meanAnomalyAtEpoch: 0,
            epoch: 2451545,
            period: 0
          }
        ]
      : [],
    rotationObjects: [],
    physicalObjects: [],
    renderingObjects: [],
    placements: [{ id: 1, actorId: 3, x: 0, y: 0, z: 0, ...placement } as DatabaseSnapshot['placements'][number]],
    resources: [],
    actorResource: []
  }
}

const lagrangeErrors = (db: DatabaseSnapshot) =>
  validateDatabase(db).errors.filter((e) => e.collection === 'placements' && /lagrange/.test(e.message))

describe('validateDatabase — размещение в точке Лагранжа родителя', () => {
  it('lagrange 4 у ребёнка планеты с орбитой — ошибок нет', () => {
    expect(lagrangeErrors(snapshot({ lagrange: 4 }))).toEqual([])
  })

  it('lagrange у ребёнка без орбиты у родителя — ошибка: узел остался бы в нуле', () => {
    expect(lagrangeErrors(snapshot({ lagrange: 5 }, false))).toHaveLength(1)
  })

  it('lagrange не 4 и не 5 — ошибка', () => {
    expect(lagrangeErrors(snapshot({ lagrange: 3 }))).toHaveLength(1)
  })

  it('обычное размещение без lagrange проверкой не трогается', () => {
    expect(lagrangeErrors(snapshot({ x: 1, y: 0, z: 2 }))).toEqual([])
  })
})
