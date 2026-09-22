import { describe, it, expect } from 'vitest'
import { Categories } from '@storage/database'
import { AllowedCategories } from '@/core/models/types'
import { OBSERVED_TYPES } from '@/core/services/SceneObserver'
import { renderingDataTemplates } from '@/ui/editor/forms/dataTemplates'
import { validateDatabase, DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'

describe('категория пояса астероидов', () => {
  it('заведена в таблице под id 11', () => {
    const category = Categories.find((c) => c.alias === 'asteroidBelt')

    expect(category).toBeDefined()
    expect(category!.id).toBe(11)
  })

  it('объявлена в AllowedCategories', () => {
    expect(Object.keys(AllowedCategories)).toContain('asteroidBelt')
  })

  it('не попала в наблюдаемые типы — не навигационное тело, маркера нет', () => {
    expect(OBSERVED_TYPES).not.toContain('asteroidBelt')
  })

  it('имеет заготовку renderingObject.data в редакторе', () => {
    const template = renderingDataTemplates.find((t) => t.value === 'asteroidBelt')

    expect(template).toBeDefined()
    expect(Object.keys(template!.data as object)).toEqual([
      'innerRadiusAu',
      'outerRadiusAu',
      'thicknessAu',
      'meanSpacingKm',
      'asteroidSizeKm',
      'profile',
      'seed',
      'structure',
      'dustEnabled',
      'dustColor',
      'dustTauGrazing',
      'dustScaleHeightKm',
      'spinPeriodHours',
      'pointCount',
      'pointScale'
    ])
  })
})

/** Минимальный валидный снимок для проверок валидатора ниже */
function baseSnapshot(): DatabaseSnapshot {
  return {
    categories: [
      { id: 1, alias: 'barycenter', name: 'Barycenter' },
      { id: 11, alias: 'asteroidBelt', name: 'Asteroid belt' }
    ],
    actors: [
      { id: 10, categoryId: 1, parentId: null, name: 'Root', description: '', color: '#fff' },
      { id: 12, categoryId: 11, parentId: 10, name: 'Belt', description: '', color: '#fff' }
    ],
    orbits: [],
    rotationObjects: [],
    physicalObjects: [],
    renderingObjects: [],
    placements: [],
    resources: [],
    actorResource: []
  }
}

const beltRow = () => ({
  id: 1,
  actorId: 12,
  data: {
    innerRadiusAu: 42,
    outerRadiusAu: 58,
    thicknessAu: 0.8,
    meanSpacingKm: 60
  } as Record<string, unknown>
})

function snapshotWith(row: ReturnType<typeof beltRow>): DatabaseSnapshot {
  const db = baseSnapshot()
  db.renderingObjects.push(row)
  return db
}

describe('validateDatabase — пояс: правило positioning "placed"', () => {
  it('placements пояс никогда не проверяет как ошибку — своя позиция не нужна', () => {
    // Пояс без placements и без orbit — это штатно (barycenter уже в нуле системы)
    expect(validateDatabase(snapshotWith(beltRow())).errors).toEqual([])
  })

  it('orbit у пояса — ошибка: категория "placed", а не "keplerian"', () => {
    const db = snapshotWith(beltRow())
    db.orbits.push({
      id: 1,
      actorId: 12,
      semiMajorAxis: 1,
      eccentricity: 0,
      inclination: 0,
      argOfPeriapsis: 0,
      ascendingNode: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 2451545,
      period: 0
    })

    const result = validateDatabase(db)
    expect(result.errors.some((e) => e.collection === 'orbits' && /placed/.test(e.message))).toBe(true)
  })
})

describe('validateDatabase — форма конфига пояса астероидов', () => {
  it('валидная строка проходит без ошибок формы', () => {
    expect(validateDatabase(snapshotWith(beltRow())).errors.filter((e) => /asteroidBelt/.test(e.message))).toEqual(
      []
    )
  })

  it('ловит outerRadiusAu не больше innerRadiusAu', () => {
    const row = beltRow()
    row.data.outerRadiusAu = 42

    expect(
      validateDatabase(snapshotWith(row)).errors.some((e) => /data\.outerRadiusAu/.test(e.message))
    ).toBe(true)
  })

  it('ловит неположительный innerRadiusAu', () => {
    const row = beltRow()
    row.data.innerRadiusAu = 0

    expect(
      validateDatabase(snapshotWith(row)).errors.some((e) => /data\.innerRadiusAu/.test(e.message))
    ).toBe(true)
  })

  it('ловит неположительный thicknessAu', () => {
    const row = beltRow()
    row.data.thicknessAu = -1

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /data\.thicknessAu/.test(e.message))).toBe(true)
  })

  it('ловит неположительный meanSpacingKm', () => {
    const row = beltRow()
    row.data.meanSpacingKm = 0

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /data\.meanSpacingKm/.test(e.message))).toBe(true)
  })

  it('строки других категорий этой проверкой не трогаются', () => {
    const db = baseSnapshot()
    db.categories.push({ id: 2, alias: 'planet', name: 'Planet' })
    db.actors.push({ id: 13, categoryId: 2, parentId: 10, name: 'P', description: '', color: '#fff' })
    // у планеты нет ни innerRadiusAu, ни thicknessAu — это не повод ругаться
    db.renderingObjects.push({ id: 2, actorId: 13, data: { emission: 1, bumpScale: 0 } })

    expect(validateDatabase(db).errors.filter((e) => /asteroidBelt/.test(e.message))).toEqual([])
  })
})
