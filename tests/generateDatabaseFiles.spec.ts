import { describe, it, expect } from 'vitest'
import { generateDatabaseFiles, GeneratorInput } from '@/core/framework/generation/generateDatabaseFiles'
import { DatabaseSnapshot, ScenarioRefs } from '@/core/framework/validation/validateDatabase'

function parseGeneratedArray(content: string): unknown[] {
  const start = content.indexOf('= [')
  if (start === -1) throw new Error('Generated file has unexpected shape')

  const arrayLiteral = content.slice(start + 2) // с '['
  // отрезаем хвост после закрывающей скобки массива верхнего уровня
  // (файл заканчивается на "]\n")
  const lastBracket = arrayLiteral.lastIndexOf(']')
  const expr = arrayLiteral.slice(0, lastBracket + 1)

  // eslint-disable-next-line no-new-func
  return Function(`return (${expr})`)() as unknown[]
}

function fileByName(files: { path: string; content: string }[], name: string): string {
  const file = files.find((f) => f.path.endsWith(`/${name}.ts`))
  if (!file) throw new Error(`Generated file ${name}.ts not found`)
  return file.content
}

function syntheticSnapshot(): DatabaseSnapshot {
  return {
    categories: [
      { id: 1, alias: 'star', name: 'Star' },
      { id: 2, alias: 'planet', name: 'Planet' }
    ],
    actors: [
      { id: 10, categoryId: 1, parentId: null, name: 'Root', description: '', color: '#fff' },
      { id: 11, categoryId: 2, parentId: 10, name: "O'Neill", description: 'quote " and \\ slash', color: '#abc' },
      { id: 12, categoryId: 2, parentId: 10, name: 'Second', description: '', color: '#def' }
    ],
    orbits: [
      {
        id: 1,
        actorId: 11,
        semiMajorAxis: 1.5e-3,
        eccentricity: 0,
        inclination: 28.05,
        argOfPeriapsis: 0,
        ascendingNode: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 2451545,
        period: 0
      }
    ],
    rotationObjects: [],
    physicalObjects: [
      {
        id: 1,
        actorId: 11,
        parentId: null,
        mass: 5.9736e24,
        radius: 6360,
        axialTilt: 23.43,
        orbitalPeriod: 0,
        rotationPeriod: 23.9,
        temperature: 0
      }
    ],
    renderingObjects: [
      { id: 1, actorId: 11, data: { emission: 1, bumpScale: 0.8 } },
      // вложенные массивы/объекты — как в атмосферах
      { id: 2, actorId: 12, data: { rayleigh: [0.0058, 0.0135, 0.0331], layers: [{ width: 25, scale: 0 }], g: 0.8 } }
    ],
    placements: [],
    resources: [
      { id: 90, resourceType: 'diffuse', lifecycle: 'resident', path: 'sun.png', lifetime: 0, colorSpace: 'srgb' },
      { id: 16, resourceType: 'night', lifecycle: 'streamable', path: 'planets/x/y.png', lifetime: 60000 }
    ],
    actorResource: [{ id: 1, actorId: 11, resourceId: 16 }]
  }
}

describe('generateDatabaseFiles — структура и контракт', () => {
  it('создаёт 9 файлов таблиц + index', () => {
    const files = generateDatabaseFiles(syntheticSnapshot())

    expect(files).toHaveLength(10)
    expect(files.some((f) => f.path.endsWith('/index.ts'))).toBe(true)
  })

  it('сохраняет контрактные имена экспортов (как ждёт config/database.ts)', () => {
    const files = generateDatabaseFiles(syntheticSnapshot())

    expect(fileByName(files, 'actors')).toMatch(/export const Actors: IActor\[\]/)
    expect(fileByName(files, 'physicalObjects')).toMatch(/export const PhysicalObjects: IPhysicalObject\[\]/)
    expect(fileByName(files, 'resources')).toMatch(/export const Resources: IResource\[\]/)
    expect(fileByName(files, 'categories')).toMatch(/export const Categories: ICategory\[\]/)
  })

  it('index реэкспортит все восемь массивов', () => {
    const files = generateDatabaseFiles(syntheticSnapshot())
    const index = files.find((f) => f.path.endsWith('/index.ts'))!.content

    for (const name of [
      'Categories',
      'Actors',
      'Orbits',
      'RotationObjects',
      'PhysicalObjects',
      'RenderingObjects',
      'Placements',
      'Resources',
      'ActorResource'
    ]) {
      expect(index).toContain(`export { ${name} }`)
    }
  })

  it('помечает файлы как авто-генерируемые', () => {
    const files = generateDatabaseFiles(syntheticSnapshot())
    expect(fileByName(files, 'actors')).toMatch(/AUTO-GENERATED/)
  })

  it('пустая таблица генерирует пустой массив', () => {
    const files = generateDatabaseFiles(syntheticSnapshot())
    expect(fileByName(files, 'placements')).toMatch(/export const Placements: IPlacement\[\] = \[\]/)
  })

  it('actorResource (pivot) round-trip', () => {
    const snap = syntheticSnapshot()
    const files = generateDatabaseFiles(snap)
    const parsed = parseGeneratedArray(fileByName(files, 'actorResource'))
    expect(parsed).toEqual(snap.actorResource)
  })

  it('большие числа сериализуются в экспоненту (TS80008)', () => {
    const snap = syntheticSnapshot()
    snap.physicalObjects.push({
      id: 99,
      actorId: 11,
      parentId: null,
      mass: 6.176e20,
      radius: 536,
      axialTilt: 0,
      orbitalPeriod: 1,
      rotationPeriod: 10,
      temperature: 0
    })
    const files = generateDatabaseFiles(snap, [], { skipValidation: true })
    const content = fileByName(files, 'physicalObjects')
    // не должно быть простыни нулей; должна быть экспонента
    expect(content).toMatch(/6\.176e20/)
    // round-trip: значение сохранилось
    const parsed = parseGeneratedArray(content) as Array<{ id: number; mass: number }>
    expect(parsed.find((p) => p.id === 99)!.mass).toBe(6.176e20)
  })
})

describe('generateDatabaseFiles — round-trip (обратимость)', () => {
  it('actors переживают сериализацию без потерь, включая спецсимволы', () => {
    const snap = syntheticSnapshot()
    const files = generateDatabaseFiles(snap)

    const parsed = parseGeneratedArray(fileByName(files, 'actors'))

    expect(parsed).toEqual(snap.actors)
  })

  it('physicalObjects с экспонентой и дробями идентичны', () => {
    const snap = syntheticSnapshot()
    const files = generateDatabaseFiles(snap)

    const parsed = parseGeneratedArray(fileByName(files, 'physicalObjects'))

    expect(parsed).toEqual(snap.physicalObjects)
  })

  it('renderingObjects с вложенными массивами и объектами идентичны', () => {
    const snap = syntheticSnapshot()
    const files = generateDatabaseFiles(snap)

    const parsed = parseGeneratedArray(fileByName(files, 'renderingObjects'))

    expect(parsed).toEqual(snap.renderingObjects)
  })

  it('resources с null actorId и опциональными полями идентичны', () => {
    const snap = syntheticSnapshot()
    const files = generateDatabaseFiles(snap)

    const parsed = parseGeneratedArray(fileByName(files, 'resources'))

    expect(parsed).toEqual(snap.resources)
  })

  it('детерминизм: повторная генерация даёт идентичный вывод', () => {
    const snap = syntheticSnapshot()
    const a = generateDatabaseFiles(snap)
    const b = generateDatabaseFiles(snap)

    expect(a).toEqual(b)
  })
})

describe('generateDatabaseFiles — защита валидатором', () => {
  it('отказывается генерировать при ошибке целостности', () => {
    const snap = syntheticSnapshot()
    snap.orbits.push({
      id: 1,
      actorId: 11,
      semiMajorAxis: 2,
      eccentricity: 0,
      inclination: 0,
      argOfPeriapsis: 0,
      ascendingNode: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 2451545,
      period: 0
    }) // дубль id

    expect(() => generateDatabaseFiles(snap)).toThrow(/integrity error/)
  })

  it('skipValidation позволяет генерацию невалидных данных (для отладки)', () => {
    const snap = syntheticSnapshot()
    snap.orbits.push({
      id: 1,
      actorId: 11,
      semiMajorAxis: 2,
      eccentricity: 0,
      inclination: 0,
      argOfPeriapsis: 0,
      ascendingNode: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 2451545,
      period: 0
    })

    expect(() => generateDatabaseFiles(snap, [], { skipValidation: true })).not.toThrow()
  })
})

describe('generateDatabaseFiles — round-trip на реальном database', () => {
  it('реальные данные переживают генерацию без потерь', async () => {
    const { database } = await import('@/config/database')

    const snapshot: GeneratorInput = {
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

    const { Scenarios } = await import('@/config/scenarios')
    const scenarioRefs: ScenarioRefs[] = Scenarios.map((s) => ({
      id: s.id,
      rootId: s.rootId,
      lightSources: s.lightSources,
      skybox: s.skybox
    }))

    const files = generateDatabaseFiles(snapshot, scenarioRefs)

    // каждая таблица: распарсить сгенерированное и сверить с исходным
    const tables: Array<[string, unknown[]]> = [
      ['categories', snapshot.categories],
      ['actors', snapshot.actors],
      ['orbits', snapshot.orbits],
      ['rotationObjects', snapshot.rotationObjects],
      ['physicalObjects', snapshot.physicalObjects],
      ['renderingObjects', snapshot.renderingObjects],
      ['placements', snapshot.placements],
      ['resources', snapshot.resources],
      ['actorResource', snapshot.actorResource]
    ]

    for (const [name, original] of tables) {
      const parsed = parseGeneratedArray(fileByName(files, name))
      expect(parsed, `table ${name} round-trip mismatch`).toEqual(original)
    }
  })
})
