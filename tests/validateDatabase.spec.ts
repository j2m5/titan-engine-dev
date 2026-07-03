import { describe, it, expect } from 'vitest'
import { validateDatabase, DatabaseSnapshot, ScenarioRefs } from '@/core/framework/validation/validateDatabase'

/**
 * Минимальный валидный снимок: один анкор-актор (galaxy) без обязательных связей.
 * Каждый тест мутирует копию под конкретный нарушаемый инвариант.
 */
function baseSnapshot(): DatabaseSnapshot {
  return {
    categories: [
      { id: 1, alias: 'galaxy', name: 'Galaxy' },
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
      orbitalPeriod: 1,
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
    db.actors.push({ id: 11, categoryId: 'wormhole' as any, parentId: 10, name: 'X', description: '', color: '#fff' })

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
    db.resources.push({ id: 90, resourceType: 'diffuse', lifecycle: 'resident', path: 'x.png', lifetime: 0 } as any)
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
    db.resources.push({ id: 90, resourceType: 'diffuse', lifecycle: 'resident', path: 'x.png', lifetime: 0 } as any)
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
      orbitalPeriod: 1,
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

  it('анкор (galaxy) без связей не даёт warnings', () => {
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
      orbitalPeriod: 0,
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
    const scenarios: ScenarioRefs[] = [{ id: 1, rootId: 999, galaxyId: 10, lightSources: [], skybox: [] }]

    const result = validateDatabase(baseSnapshot(), scenarios)

    expect(result.errors.some((e) => e.collection === 'scenarios' && /rootId=999/.test(e.message))).toBe(true)
  })

  it('ловит skybox, ссылающийся на несуществующий ресурс', () => {
    const scenarios: ScenarioRefs[] = [{ id: 1, rootId: 10, galaxyId: 10, lightSources: [], skybox: [9999] }]

    const result = validateDatabase(baseSnapshot(), scenarios)

    expect(result.errors.some((e) => /skybox\[\]=9999/.test(e.message))).toBe(true)
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
describe('validateDatabase — реальный database (базлайн)', () => {
  it('текущие данные приложения валидны (0 errors)', async () => {
    const { database } = await import('@/config/database')
    const { Scenarios } = await import('@/config/scenarios')

    const snapshot: DatabaseSnapshot = {
      categories: database.get('categories') as any,
      actors: database.get('actors') as any,
      orbits: database.get('orbits') as any,
      rotationObjects: database.get('rotationObjects') as any,
      physicalObjects: database.get('physicalObjects') as any,
      renderingObjects: database.get('renderingObjects') as any,
      placements: database.get('placements') as any,
      resources: database.get('resources') as any,
      actorResource: database.get('actorResource') as any
    }

    const scenarioRefs: ScenarioRefs[] = Scenarios.map((s) => ({
      id: s.id,
      rootId: s.rootId,
      galaxyId: s.galaxyId,
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
