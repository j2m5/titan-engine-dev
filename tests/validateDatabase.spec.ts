import { describe, it, expect } from 'vitest'
import { validateDatabase, DatabaseSnapshot, ScenarioRefs } from '@/core/framework/validation/validateDatabase'
import { shippedSnapshot } from './helpers/shippedSnapshot'

/**
 * Минимальный валидный снимок: один анкор-актор (barycenter) без обязательных связей.
 * Каждый тест мутирует копию под конкретный нарушаемый инвариант.
 */
function baseSnapshot(): DatabaseSnapshot {
  return {
    categories: [
      { id: 1, alias: 'barycenter', name: 'Barycenter' },
      { id: 2, alias: 'planet', name: 'Planet' },
      { id: 3, alias: 'star', name: 'Star' }
    ],
    actors: [{ id: 10, categoryId: 1, parentId: null, name: 'Root', description: '', color: '#fff' }],
    orbits: [],
    rotationObjects: [],
    physicalObjects: [],
    renderingObjects: [],
    placements: [],
    resources: [],
    actorResource: []
  }
}

/** Полноценный актор-планета со всеми обязательными связями — без warnings */
function planet(id: number, parentId: number) {
  return { id, categoryId: 2, parentId, name: `P${id}`, description: '', color: '#fff' }
}

describe('validateDatabase — optional enums', () => {
  it.each([null, 0, 2, '1', true])('rejects invalid direction %j', (direction) => {
    const db = baseSnapshot()
    db.rotationObjects.push({ id: 1, actorId: 10, meridianAngle: 0, ascendingNode: 0,
      inclination: 0, period: 1, direction: direction as never })
    expect(validateDatabase(db).errors).toContainEqual(expect.objectContaining({
      collection: 'rotationObjects', entity: 1, message: expect.stringContaining('direction')
    }))
  })

  it.each([undefined, 1, -1])('accepts direction %j', (direction) => {
    const db = baseSnapshot()
    db.rotationObjects.push({ id: 1, actorId: 10, meridianAngle: 0, ascendingNode: 0,
      inclination: 0, period: 1, direction: direction as 1 | -1 | undefined })
    expect(validateDatabase(db).ok).toBe(true)
  })

  it.each([null, 0, 6, '4', true])('rejects invalid lagrange %j', (lagrange) => {
    const db = baseSnapshot()
    db.categories.push({ id: 4, alias: 'nebula', name: 'Nebula' })
    db.actors.push({ ...planet(11, 10), categoryId: 4 })
    db.placements.push({ id: 1, actorId: 11, x: 0, y: 0, z: 0, lagrange: lagrange as never })
    expect(validateDatabase(db).errors).toContainEqual(expect.objectContaining({
      collection: 'placements', entity: 1, message: expect.stringContaining('lagrange')
    }))
  })
})

describe('validateDatabase — rendering data boundary', () => {
  it.each([1, true, 'x', 0, false, '', [], null, undefined])('rejects non-object data %j without throwing', (data) => {
    const db = baseSnapshot()
    db.renderingObjects.push({ id: 1, actorId: 10, data: data as never })

    const result = validateDatabase(db)

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({
      collection: 'renderingObjects', entity: 1, message: expect.stringMatching(/data.*object/i)
    }))
  })

  it('accepts objects containing nested arrays and null values', () => {
    const db = baseSnapshot()
    db.renderingObjects.push({ id: 1, actorId: 10, data: { values: [1, 2], optional: null } })
    expect(validateDatabase(db).ok).toBe(true)
  })
})

describe('validateDatabase — форма данных атмосфер', () => {
  /** Валидный слой плотности и валидная строка атмосферы для мутаций */
  const layer = () => ({ width: 0, expTerm: 1, expScale: -0.125, linearTerm: 0, constantTerm: 0 })
  const atmosphereRow = () => ({
    id: 1,
    actorId: 11,
    data: {
      solarIrradiance: [1.474, 1.8504, 1.91198],
      sunAngularRadius: 0.004,
      bottomRadius: 6360,
      topRadius: 6420,
      rayleighDensity: [layer(), layer()],
      rayleighScattering: [0.005802, 0.013558, 0.0331],
      mieDensity: [layer(), layer()],
      mieScattering: [0.003996, 0.003996, 0.003996],
      mieExtinction: [0.00444, 0.00444, 0.00444],
      miePhaseFunctionG: 0.8,
      absorptionDensity: [layer(), layer()],
      absorptionExtinction: [0.00065, 0.001881, 0.000085],
      groundAlbedo: [0.1, 0.1, 0.1],
      muSMin: -0.207912
    }
  })

  function snapshotWith(row: ReturnType<typeof atmosphereRow>): DatabaseSnapshot {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10))
    db.renderingObjects.push(row)
    return db
  }

  it('валидная строка атмосферы проходит без ошибок формы', () => {
    const result = validateDatabase(snapshotWith(atmosphereRow()))

    expect(result.errors.some((e) => /atmosphere/i.test(e.message))).toBe(false)
  })

  it('ловит плотностный профиль-одиночку вместо пары слоёв', () => {
    const row = atmosphereRow()
    // классическая поломка контракта: объект вместо [layer, layer]
    row.data.absorptionDensity = layer() as never

    const result = validateDatabase(snapshotWith(row))

    expect(result.errors.some((e) => /absorptionDensity/.test(e.message))).toBe(true)
  })

  it('ловит спектральную тройку неверной длины', () => {
    const row = atmosphereRow()
    row.data.mieScattering = [0.001, 0.001] as never

    const result = validateDatabase(snapshotWith(row))

    expect(result.errors.some((e) => /mieScattering/.test(e.message))).toBe(true)
  })

  it('ловит extinction меньше scattering (нефизично)', () => {
    const row = atmosphereRow()
    row.data.mieScattering = [0.01, 0.01, 0.01] as never
    row.data.mieExtinction = [0.005, 0.005, 0.005] as never

    const result = validateDatabase(snapshotWith(row))

    expect(result.warnings.some((e) => /extinction/i.test(e.message))).toBe(true)
  })
})

describe('validateDatabase — якорь атмосферы к планете', () => {
  const layer = () => ({ width: 0, expTerm: 1, expScale: -0.125, linearTerm: 0, constantTerm: 0 })

  /**
   * Реальная топология: планета (актор 11, physicalObject с radius)
   * и её атмосфера — отдельный дочерний актор 12 с atmosphere-данными.
   */
  function snapshotWithAtmosphere(bottomRadius: number, topRadius: number, planetRadius: number): DatabaseSnapshot {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10), planet(12, 11))
    db.physicalObjects.push({
      id: 1,
      actorId: 11,
      parentId: null,
      mass: 1,
      radius: planetRadius,
      axialTilt: 0,
      rotationPeriod: 1,
      temperature: 0
    })
    db.renderingObjects.push({
      id: 1,
      actorId: 12,
      data: {
        solarIrradiance: [1.474, 1.8504, 1.91198],
        sunAngularRadius: 0.004,
        bottomRadius,
        topRadius,
        rayleighDensity: [layer(), layer()],
        rayleighScattering: [0.005802, 0.013558, 0.0331],
        mieDensity: [layer(), layer()],
        mieScattering: [0.003996, 0.003996, 0.003996],
        mieExtinction: [0.00444, 0.00444, 0.00444],
        miePhaseFunctionG: 0.8,
        absorptionDensity: [layer(), layer()],
        absorptionExtinction: [0.00065, 0.001881, 0.000085],
        groundAlbedo: [0.1, 0.1, 0.1],
        muSMin: -0.207912
      }
    })
    return db
  }

  it('bottomRadius, совпадающий с радиусом родительской планеты, проходит', () => {
    const result = validateDatabase(snapshotWithAtmosphere(6360, 6420, 6360))

    expect(result.errors.some((e) => /bottomRadius/.test(e.message))).toBe(false)
  })

  it('ловит рассогласование bottomRadius с радиусом планеты (кейс Yavin Prime)', () => {
    const result = validateDatabase(snapshotWithAtmosphere(195550, 196000, 195500))

    expect(result.errors.some((e) => /bottomRadius/.test(e.message) && /195500/.test(e.message))).toBe(true)
  })

  it('ловит topRadius <= bottomRadius (NaN в LUT-генераторе)', () => {
    const result = validateDatabase(snapshotWithAtmosphere(6420, 6360, 6420))

    expect(result.errors.some((e) => /radii invalid/i.test(e.message))).toBe(true)
  })

  it('ловит bottomRadius строкой вместо числа', () => {
    const result = validateDatabase(snapshotWithAtmosphere('100' as unknown as number, 6420, 6360))

    expect(result.errors.some((e) => /radii invalid/i.test(e.message))).toBe(true)
  })

  it('атмосфера без физобъекта у родителя не падает и не ругается на якорь', () => {
    const db = snapshotWithAtmosphere(6360, 6420, 6360)
    db.physicalObjects = []

    const result = validateDatabase(db)

    expect(result.errors.some((e) => /bottomRadius/.test(e.message))).toBe(false)
  })
})

describe('validateDatabase — структура результата', () => {
  it('пустой валидный снимок проходит без ошибок', () => {
    const result = validateDatabase(baseSnapshot())

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('ok=false при наличии хотя бы одной ошибки', () => {
    const db = baseSnapshot()
    db.actors.push({ id: 10, categoryId: 1, parentId: null, name: 'Dup', description: '', color: '#fff' })

    const result = validateDatabase(db)

    expect(result.ok).toBe(false)
  })
})

describe('validateDatabase — уникальность ID', () => {
  it('ловит дубль id в актоарх', () => {
    const db = baseSnapshot()
    db.actors.push({ id: 10, categoryId: 1, parentId: null, name: 'Dup', description: '', color: '#fff' })

    const result = validateDatabase(db)

    expect(result.errors.some((e) => /Duplicate id 10/.test(e.message))).toBe(true)
  })

  it('ловит дубль id в orbits', () => {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10), planet(12, 10))
    db.orbits.push(
      {
        id: 1,
        actorId: 11,
        semiMajorAxis: 1,
        eccentricity: 0,
        inclination: 0,
        argOfPeriapsis: 0,
        ascendingNode: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 2451545,
        period: 0
      },
      {
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
      }
    )

    const result = validateDatabase(db)

    expect(result.errors.some((e) => e.collection === 'orbits' && /Duplicate/.test(e.message))).toBe(true)
  })
})

describe('validateDatabase — внешние ключи', () => {
  it('ловит висячий categoryId', () => {
    const db = baseSnapshot()
    db.actors.push({ id: 11, categoryId: 999, parentId: 10, name: 'X', description: '', color: '#fff' })

    const result = validateDatabase(db)

    expect(result.errors.some((e) => /categoryId=999/.test(e.message))).toBe(true)
  })

  it('принимает строковый алиас категории', () => {
    const db = baseSnapshot()
    db.actors.push({ id: 11, categoryId: 'planet', parentId: 10, name: 'X', description: '', color: '#fff' })

    const result = validateDatabase(db)

    expect(result.errors.some((e) => /categoryId/.test(e.message))).toBe(false)
  })

  it('ловит неизвестный строковый алиас категории', () => {
    const db = baseSnapshot()
    db.actors.push({
      id: 11,
      // намеренно битое значение: валидатор обязан поймать несуществующую категорию
      categoryId: 'wormhole' as unknown as number,
      parentId: 10,
      name: 'X',
      description: '',
      color: '#fff'
    })

    const result = validateDatabase(db)

    expect(result.errors.some((e) => /not a known category alias/.test(e.message))).toBe(true)
  })

  it('ловит висячий parentId', () => {
    const db = baseSnapshot()
    db.actors.push({ id: 11, categoryId: 2, parentId: 777, name: 'X', description: '', color: '#fff' })

    const result = validateDatabase(db)

    expect(result.errors.some((e) => /parentId=777/.test(e.message))).toBe(true)
  })

  it('ловит висячий actorId в orbit', () => {
    const db = baseSnapshot()
    db.orbits.push({
      id: 1,
      actorId: 555,
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

    expect(result.errors.some((e) => e.collection === 'orbits' && /actorId=555/.test(e.message))).toBe(true)
  })
})

describe('validateDatabase — pivot actor_resource', () => {
  it('ловит висячий actorId в пивоте', () => {
    const db = baseSnapshot()
    db.resources.push({ id: 90, resourceType: 'diffuse', lifecycle: 'resident', path: 'x.png' })
    db.actorResource.push({ id: 1, actorId: 999, resourceId: 90 })
    const result = validateDatabase(db)
    expect(result.errors.some((e) => e.collection === 'actorResource' && /actorId=999/.test(e.message))).toBe(true)
  })

  it('ловит висячий resourceId в пивоте', () => {
    const db = baseSnapshot()
    db.actorResource.push({ id: 1, actorId: 10, resourceId: 888 })
    const result = validateDatabase(db)
    expect(result.errors.some((e) => /resourceId=888/.test(e.message))).toBe(true)
  })

  it('валидная связь пивота не даёт ошибок', () => {
    const db = baseSnapshot()
    db.resources.push({ id: 90, resourceType: 'diffuse', lifecycle: 'resident', path: 'x.png' })
    db.actorResource.push({ id: 1, actorId: 10, resourceId: 90 })
    const result = validateDatabase(db)
    expect(result.errors.filter((e) => e.collection === 'actorResource')).toHaveLength(0)
  })
})

describe('validateDatabase — физика', () => {
  it('масса <= 0 даёт warning', () => {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10))
    db.physicalObjects.push({
      id: 1,
      actorId: 11,
      parentId: null,
      mass: 0,
      radius: 1,
      axialTilt: 0,
      rotationPeriod: 1,
      temperature: 0
    })
    const result = validateDatabase(db)
    expect(result.ok).toBe(true) // warning, не error
    expect(result.warnings.some((w) => /non-positive mass/.test(w.message))).toBe(true)
  })
})

describe('validateDatabase — дерево акторов', () => {
  it('ловит самоссылку parentId === id', () => {
    const db = baseSnapshot()
    db.actors.push({ id: 11, categoryId: 2, parentId: 11, name: 'Self', description: '', color: '#fff' })

    const result = validateDatabase(db)

    expect(result.errors.some((e) => /its own parent/.test(e.message))).toBe(true)
  })

  it('ловит цикл из двух акторов', () => {
    const db = baseSnapshot()
    db.actors.push(
      { id: 11, categoryId: 2, parentId: 12, name: 'A', description: '', color: '#fff' },
      { id: 12, categoryId: 2, parentId: 11, name: 'B', description: '', color: '#fff' }
    )

    const result = validateDatabase(db)

    expect(result.errors.some((e) => /Cycle in actor tree/.test(e.message))).toBe(true)
  })
})

describe('validateDatabase — кардинальность hasOne', () => {
  it('ловит два orbit на одного актора', () => {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10))
    db.orbits.push(
      {
        id: 1,
        actorId: 11,
        semiMajorAxis: 1,
        eccentricity: 0,
        inclination: 0,
        argOfPeriapsis: 0,
        ascendingNode: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 2451545,
        period: 0
      },
      {
        id: 2,
        actorId: 11,
        semiMajorAxis: 2,
        eccentricity: 0,
        inclination: 0,
        argOfPeriapsis: 0,
        ascendingNode: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 2451545,
        period: 0
      }
    )

    const result = validateDatabase(db)

    expect(result.errors.some((e) => e.collection === 'orbits' && /expected at most 1/.test(e.message))).toBe(true)
  })

  it('один orbit на актора — норма', () => {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10))
    db.orbits.push({
      id: 1,
      actorId: 11,
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

    expect(result.errors.filter((e) => e.collection === 'orbits')).toHaveLength(0)
  })
})

describe('validateDatabase — предупреждения о полноте', () => {
  it('планета без physical/rendering/orbit даёт warnings, но не errors', () => {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10))

    const result = validateDatabase(db)

    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => /no physicalObject/.test(w.message))).toBe(true)
    expect(result.warnings.some((w) => /no renderingObject/.test(w.message))).toBe(true)
    expect(result.warnings.some((w) => /no orbit/.test(w.message))).toBe(true)
  })

  it('анкор (barycenter) без связей не даёт warnings', () => {
    const result = validateDatabase(baseSnapshot())

    expect(result.warnings).toHaveLength(0)
  })

  it('центральное тело (star) без orbit не предупреждается об орбите', () => {
    const db = baseSnapshot()
    db.actors.push({ id: 11, categoryId: 3, parentId: 10, name: 'Sun', description: '', color: '#ff0' })
    // дадим ему physical+rendering, чтобы остались только потенциальный orbit-warning
    db.physicalObjects.push({
      id: 1,
      actorId: 11,
      parentId: null,
      mass: 1,
      radius: 1,
      axialTilt: 0,
      rotationPeriod: 1,
      temperature: 5000
    })
    db.renderingObjects.push({ id: 1, actorId: 11, data: {} })

    const result = validateDatabase(db)

    expect(result.warnings.some((w) => /no orbit/.test(w.message))).toBe(false)
  })
})

describe('validateDatabase — ссылки сценариев', () => {
  it('ловит rootId, указывающий на несуществующего актора', () => {
    const scenarios: ScenarioRefs[] = [{ id: 1, rootId: 999, lightSources: [], skybox: [] }]

    const result = validateDatabase(baseSnapshot(), scenarios)

    expect(result.errors.some((e) => e.collection === 'scenarios' && /rootId=999/.test(e.message))).toBe(true)
  })

  it('ловит skybox, ссылающийся на несуществующий ресурс', () => {
    const scenarios: ScenarioRefs[] = [{ id: 1, rootId: 10, lightSources: [], skybox: [9999] }]

    const result = validateDatabase(baseSnapshot(), scenarios)

    expect(result.errors.some((e) => /skybox\[\]=9999/.test(e.message))).toBe(true)
  })
})

describe('validateDatabase — режимы позиционирования', () => {
  /** Снимок с полным набором категорий, включая статическую туманность */
  function positioningSnapshot(): DatabaseSnapshot {
    const db = baseSnapshot()
    db.categories.push(
      { id: 4, alias: 'atmosphere', name: 'Atmosphere' },
      { id: 5, alias: 'nebula', name: 'Nebula' }
    )
    // планета (кеплерова), туманность (статическая), атмосфера (примонтированная)
    db.actors.push(
      planet(11, 10),
      { id: 12, categoryId: 5, parentId: 10, name: 'Neb', description: '', color: '#fff' },
      { id: 13, categoryId: 4, parentId: 11, name: 'Atm', description: '', color: '#fff' }
    )
    db.renderingObjects.push({ id: 1, actorId: 12, data: { size: 100 } })
    return db
  }

  it('placements у туманности — легальны', () => {
    const db = positioningSnapshot()
    db.placements.push({ id: 1, actorId: 12, x: 0, y: 0, z: 0 })

    const result = validateDatabase(db)

    expect(result.errors.filter((e) => e.collection === 'placements')).toEqual([])
  })

  it('placements у планеты — ошибка: позиция будет перетёрта кеплеровой моделью', () => {
    const db = positioningSnapshot()
    db.placements.push({ id: 1, actorId: 11, x: 1, y: 0, z: 0 })

    const result = validateDatabase(db)

    expect(result.errors.some((e) => e.collection === 'placements' && /keplerian/.test(e.message))).toBe(true)
  })

  it('placements у атмосферы — ошибка: своей позиции у неё нет', () => {
    const db = positioningSnapshot()
    db.placements.push({ id: 1, actorId: 13, x: 1, y: 0, z: 0 })

    const result = validateDatabase(db)

    expect(result.errors.some((e) => e.collection === 'placements' && /attached/.test(e.message))).toBe(true)
  })

  it('orbits у туманности — ошибка: статический актор не ходит по орбите', () => {
    const db = positioningSnapshot()
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

  it('orbits у планеты — легальны', () => {
    const db = positioningSnapshot()
    db.orbits.push({
      id: 1,
      actorId: 11,
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

    expect(result.errors.filter((e) => e.collection === 'orbits')).toEqual([])
  })
})

describe('validateDatabase — ожидания по категориям', () => {
  function snapshotWithCategory(alias: string, categoryId: number): DatabaseSnapshot {
    const db = baseSnapshot()
    db.categories.push({ id: categoryId, alias: alias as never, name: alias })
    db.actors.push({ id: 20, categoryId, parentId: 10, name: 'X', description: '', color: '#fff' })
    return db
  }

  it('туманности не нужны ни physicalObject, ни orbit', () => {
    const db = snapshotWithCategory('nebula', 7)
    db.renderingObjects.push({ id: 1, actorId: 20, data: { size: 100 } })

    const warnings = validateDatabase(db).warnings.filter((w) => w.entity === 20)

    expect(warnings).toEqual([])
  })

  it('туманности нужен renderingObject', () => {
    const warnings = validateDatabase(snapshotWithCategory('nebula', 7)).warnings

    expect(warnings.some((w) => w.entity === 20 && /renderingObject/.test(w.message))).toBe(true)
  })

  it('атмосфере не нужны ни physicalObject, ни orbit — своей позиции и массы у неё нет', () => {
    const db = snapshotWithCategory('atmosphere', 8)
    db.renderingObjects.push({ id: 1, actorId: 20, data: {} })

    const warnings = validateDatabase(db).warnings.filter((w) => w.entity === 20)

    expect(warnings).toEqual([])
  })

  it('планете по-прежнему нужны все три связи', () => {
    const warnings = validateDatabase(snapshotWithCategory('planet', 2)).warnings.filter((w) => w.entity === 20)

    expect(warnings).toHaveLength(3)
  })

  it('барицентр по-прежнему не требует ничего', () => {
    const warnings = validateDatabase(snapshotWithCategory('barycenter', 9)).warnings.filter((w) => w.entity === 20)

    expect(warnings).toEqual([])
  })

  it('звезде не нужна orbit, но нужны physical и rendering', () => {
    const warnings = validateDatabase(snapshotWithCategory('star', 3)).warnings.filter((w) => w.entity === 20)

    expect(warnings).toHaveLength(2)
    expect(warnings.some((w) => /orbit/.test(w.message))).toBe(false)
  })
})

describe('validateDatabase — форма конфига туманности', () => {
  /** Валидная строка туманности для мутаций */
  const nebulaRow = () => ({
    id: 1,
    actorId: 12,
    data: {
      preset: 'emission',
      seed: 5120,
      size: 360.11263,
      shape: 'disk',
      axisRatios: [1, 0.5, 1],
      edgeFalloff: 0.6,
      density: 0.5,
      palette: { stops: [{ t: 0, color: '#06141c' }], secondary: '#5aa0d8' },
      dust: { color: '#05090c' }
    } as Record<string, unknown>
  })

  function snapshotWith(row: ReturnType<typeof nebulaRow>): DatabaseSnapshot {
    const db = baseSnapshot()
    db.categories.push({ id: 5, alias: 'nebula', name: 'Nebula' })
    db.actors.push({ id: 12, categoryId: 5, parentId: 10, name: 'Neb', description: '', color: '#fff' })
    db.renderingObjects.push(row)
    return db
  }

  it('валидная строка проходит без ошибок формы', () => {
    const result = validateDatabase(snapshotWith(nebulaRow()))

    expect(result.errors.filter((e) => /nebula/i.test(e.message))).toEqual([])
  })

  it('ловит отсутствующий size', () => {
    const row = nebulaRow()
    delete row.data.size

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /data\.size/.test(e.message))).toBe(true)
  })

  it('ловит неположительный size', () => {
    const row = nebulaRow()
    row.data.size = 0

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /data\.size/.test(e.message))).toBe(true)
  })

  it('ловит неизвестную форму', () => {
    const row = nebulaRow()
    row.data.shape = 'banana'

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /data\.shape/.test(e.message))).toBe(true)
  })

  it('ловит неизвестный preset', () => {
    const row = nebulaRow()
    row.data.preset = 'neon'

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /data\.preset/.test(e.message))).toBe(true)
  })

  it('ловит axisRatios не из трёх положительных чисел', () => {
    const row = nebulaRow()
    row.data.axisRatios = [1, 0, 1]

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /data\.axisRatios/.test(e.message))).toBe(true)
  })

  it('ловит цвет не в формате #rrggbb', () => {
    const row = nebulaRow()
    row.data.dust = { color: 'teal' }

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /dust\.color/.test(e.message))).toBe(true)
  })

  it('ловит позицию стопа палитры вне [0, 1]', () => {
    const row = nebulaRow()
    row.data.palette = { stops: [{ t: 1.5, color: '#06141c' }] }

    expect(validateDatabase(snapshotWith(row)).errors.some((e) => /palette\.stops/.test(e.message))).toBe(true)
  })

  it.each(['lobes', 'cavities', 'palette.stops'])('rejects malformed %s arrays and entries', (field) => {
    for (const value of [null, {}, 7, 'bad', false, [null], [1], ['bad'], [false], [[]]]) {
      const row = nebulaRow()
      if (field === 'palette.stops') row.data.palette = { stops: value }
      else row.data[field] = value

      const result = validateDatabase(snapshotWith(row))
      expect(result.errors.some((e) => e.message.includes(`data.${field}`)), JSON.stringify(value)).toBe(true)
    }
  })

  it.each([null, [], 3, 'bad', false].map((value) => [value]))('rejects a malformed palette group: %j', (palette) => {
    const row = nebulaRow()
    row.data.palette = palette
    expect(validateDatabase(snapshotWith(row)).errors.some((e) => e.message.includes('data.palette'))).toBe(true)
  })

  it.each(['lobes', 'cavities'])('validates finite centers and numeric fields in %s', (field) => {
    const malformed: Record<string, unknown>[] = [
      { center: null }, { center: [0, 1] }, { center: [0, '1', 0] }, { center: [0, Infinity, 0] },
      { radius: '1' }, { radius: null }, { radius: NaN },
      ...(field === 'lobes' ? [{ weight: false }, { seed: Infinity }] : [{ strength: '1' }])
    ]
    for (const entry of malformed) {
      const row = nebulaRow()
      row.data[field] = [entry]
      const key = Object.keys(entry)[0]
      expect(validateDatabase(snapshotWith(row)).errors.some((e) =>
        e.message.includes(`data.${field}[0].${key}`)), String(entry[key])).toBe(true)
    }
  })

  it.each([{}, { t: 0 }, { t: 0, color: null }, { t: 0, color: 'red' }])(
    'requires a finite position and hex color for palette stops: %j', (stop) => {
      const row = nebulaRow()
      row.data.palette = { stops: [stop] }
      expect(validateDatabase(snapshotWith(row)).errors.some((e) => e.message.includes('data.palette.stops[0]'))).toBe(true)
    })

  it.each([
    { size: 30 },
    { size: 30, lobes: [], cavities: [], palette: { stops: [] } },
    { size: 30, lobes: [{}, { center: [0, -1, 0], weight: 0, seed: 0 }], cavities: [{}, { strength: 0 }] }
  ])('accepts omitted arrays, empty arrays and partial entries: %j', (data) => {
    expect(validateDatabase(snapshotWith({ ...nebulaRow(), data })).errors).toEqual([])
  })

  it('строки других категорий этой проверкой не трогаются', () => {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10))
    // у планеты нет ни size, ни shape — это не повод ругаться
    db.renderingObjects.push({ id: 1, actorId: 11, data: { emission: 1, bumpScale: 0 } })

    expect(validateDatabase(db).errors.filter((e) => /nebula/i.test(e.message))).toEqual([])
  })
})

/**
 * Базлайн: реальные данные приложения ДОЛЖНЫ проходить без ошибок.
 * Этот тест фиксирует текущее состояние как валидное и будет красным,
 * если будущая правка данных порвёт целостность (та самая боль с ID).
 *
 * warnings не проверяем на ноль — в реальных данных могут быть осознанные
 * пропуски (анкоры и т.п. уже отфильтрованы, но контент дополняется).
 */
describe('validateDatabase — лунки колец', () => {
  const moonlet = { radiusKm: 106620, azimuthDeg: 40, sizeKm: 60, gapKm: 360, model: 'pandora' }

  function ringSnapshot(m: Record<string, unknown>): DatabaseSnapshot {
    const db = baseSnapshot()
    db.categories.push({ id: 6, alias: 'ring', name: 'Ring' })
    db.actors.push(planet(11, 10), { id: 12, categoryId: 6, parentId: 11, name: 'Ring', description: '', color: '#fff' })
    db.renderingObjects.push({ id: 1, actorId: 12, data: { innerRadius: 75000, outerRadius: 126000, moonlets: [m] } })
    return db
  }

  it('годная лунка — без ошибок у строки кольца', () => {
    const errors = validateDatabase(ringSnapshot(moonlet)).errors.filter((e) => e.collection === 'renderingObjects')

    expect(errors).toEqual([])
  })

  it('радиус лунки вне кольца — ошибка с именем поля moonlets[0].radiusKm', () => {
    const errors = validateDatabase(ringSnapshot({ ...moonlet, radiusKm: 130000 })).errors

    expect(
      errors.some((e) => e.collection === 'renderingObjects' && e.entity === 1 && e.message.includes('moonlets[0].radiusKm'))
    ).toBe(true)
  })
})

describe('validateDatabase — обязательные числа', () => {
  // Форма редактора пишет пустое поле как null, мусор — как NaN; генератор
  // сериализует не-конечное в null — тело с такой орбитой пропадает со сцены
  const orbit = (patch: Record<string, unknown> = {}) => ({
    id: 1,
    actorId: 11,
    semiMajorAxis: 1,
    eccentricity: 0,
    inclination: 0,
    argOfPeriapsis: 0,
    ascendingNode: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 2451545,
    period: 0,
    ...patch
  })

  function withOrbit(patch: Record<string, unknown>): DatabaseSnapshot {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10))
    db.orbits.push(orbit(patch) as unknown as DatabaseSnapshot['orbits'][number])
    return db
  }

  it.each([
    ['null (пустое поле формы)', null],
    ['NaN (мусор в поле)', NaN],
    ['Infinity', Infinity],
    ['строка', '1']
  ])('%s в обязательном поле орбиты — ошибка, сохранение блокируется', (_name: string, value: unknown) => {
    const result = validateDatabase(withOrbit({ semiMajorAxis: value }))

    expect(result.ok).toBe(false)
    expect(
      result.errors.some((e) => e.collection === 'orbits' && /semiMajorAxis must be a finite number/.test(e.message))
    ).toBe(true)
  })

  it('конечные числа во всех обязательных полях — ошибок формы чисел нет', () => {
    const result = validateDatabase(withOrbit({}))

    expect(result.errors.filter((e) => /must be a finite number/.test(e.message))).toHaveLength(0)
  })

  it.each([
    ['parabolic eccentricity', { semiMajorAxis: 1, eccentricity: 1 }, /eccentricity must be less than 1 or greater than 1/],
    ['negative eccentricity', { semiMajorAxis: 1, eccentricity: -0.01 }, /eccentricity must be non-negative/],
    ['negative axis for ellipse', { semiMajorAxis: -1, eccentricity: 0.5 }, /semiMajorAxis must be positive for an ellipse/],
    ['positive axis for hyperbola', { semiMajorAxis: 1, eccentricity: 1.5 }, /semiMajorAxis must be negative for a hyperbola/],
    ['zero axis with nonzero eccentricity', { semiMajorAxis: 0, eccentricity: 0.5 }, /zero semiMajorAxis requires zero eccentricity/],
    ['negative axis for circle', { semiMajorAxis: -1, eccentricity: 0 }, /semiMajorAxis must be positive for an ellipse/]
  ])('rejects unsupported orbit domain: %s', (_name, patch, errorPattern) => {
    const result = validateDatabase(withOrbit(patch))

    expect(result.ok).toBe(false)
    expect(result.errors.some((issue) => issue.collection === 'orbits' && issue.entity === 1 && errorPattern.test(issue.message))).toBe(true)
  })

  it.each([
    ['stationary NullOrbit default', { semiMajorAxis: 0, eccentricity: 0 }],
    ['ellipse approaching parabolic boundary', { semiMajorAxis: 1, eccentricity: 1 - Number.EPSILON }],
    ['hyperbola approaching parabolic boundary', { semiMajorAxis: -1, eccentricity: 1 + Number.EPSILON }]
  ])('accepts supported orbit domain: %s', (_name, patch) => {
    const result = validateDatabase(withOrbit(patch))

    expect(result.errors.filter((issue) => issue.collection === 'orbits')).toHaveLength(0)
  })

  it('ловит null в физобъекте, вращении и размещении', () => {
    const db = baseSnapshot()
    db.actors.push(planet(11, 10))
    db.physicalObjects.push({
      id: 1,
      actorId: 11,
      parentId: null,
      mass: 1,
      radius: null as unknown as number,
      axialTilt: 0,
      rotationPeriod: 1,
      temperature: 0
    })
    db.rotationObjects.push({ id: 1, actorId: 11, meridianAngle: 0, ascendingNode: 0, inclination: NaN, period: 1 })
    db.placements.push({ id: 1, actorId: 10, x: 0, y: null as unknown as number, z: 0 })

    const messages = validateDatabase(db).errors.map((e) => e.message)

    expect(messages).toContain('physicalObjects#1.radius must be a finite number, got null')
    expect(messages).toContain('rotationObjects#1.inclination must be a finite number, got NaN')
    expect(messages).toContain('placements#1.y must be a finite number, got null')
  })
})

describe('validateDatabase — реальный database (базлайн)', () => {
  it('текущие данные приложения валидны (0 errors)', async () => {
    const { Scenarios } = await import('@/config/scenarios')

    const snapshot: DatabaseSnapshot = await shippedSnapshot()

    const scenarioRefs: ScenarioRefs[] = Scenarios.map((s) => ({
      id: s.id,
      rootId: s.rootId,
      lightSources: s.lightSources,
      skybox: s.skybox
    }))

    const result = validateDatabase(snapshot, scenarioRefs)

    // если упадёт — в сообщении будут перечислены конкретные нарушения
    if (!result.ok) {
      console.error('Integrity errors:\n' + result.errors.map((e) => '  - ' + e.message).join('\n'))
    }

    expect(result.errors).toHaveLength(0)
  })
})
