import { getArchetypeGeometries, morphologyForIndex } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary'
import {
  ArchetypeShape,
  generateArchetypeParams
} from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeShape'
import { buildArchetypeGeometry } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeGeometry'
import { SeededRandom, hashSectorKey } from '@/core/renderables/DetailedRingStreamingSystem/SeededRandom'
import { ASTEROID_PROFILES, type AsteroidProfileName } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'

describe('getArchetypeGeometries: библиотека K архетипов с кэшем', () => {
  // (1) Длина массива = count и все элементы — разные объекты с position/normal
  it('возвращает массив длиной count с разными BufferGeometry объектами', () => {
    const count = 5
    const geometries = getArchetypeGeometries('stony', count, 2, 0.1)

    expect(geometries.length).toBe(count)

    // Все элементы — разные объекты
    for (let i = 0; i < geometries.length; i++) {
      for (let j = i + 1; j < geometries.length; j++) {
        expect(geometries[i]).not.toBe(geometries[j])
      }
    }

    // Все имеют position и normal атрибуты
    for (const geom of geometries) {
      expect(geom.getAttribute('position')).toBeDefined()
      expect(geom.getAttribute('normal')).toBeDefined()
      expect(geom.getAttribute('position').count).toBeGreaterThan(0)
      expect(geom.getAttribute('normal').count).toBeGreaterThan(0)
    }
  })

  // (2) Повторный вызов с тем же ключом возвращает ТЕ ЖЕ объекты (===, кэш)
  it('кэширует геометрии по ключу profile|count|detail|radius', () => {
    const call1 = getArchetypeGeometries('stony', 3, 2, 0.1)
    const call2 = getArchetypeGeometries('stony', 3, 2, 0.1)

    // Один и тот же массив (===)
    expect(call1).toBe(call2)

    // Все элементы идентичны
    for (let i = 0; i < call1.length; i++) {
      expect(call1[i]).toBe(call2[i])
    }
  })

  // (3) Другой профиль → другие геометрии (и не равны попарно по первым 30 позициям)
  it('разные профили порождают разные геометрии', () => {
    const detail = 2
    const radius = 0.1
    const count = 4

    const stony = getArchetypeGeometries('stony', count, detail, radius)
    const carbonaceous = getArchetypeGeometries('carbonaceous', count, detail, radius)
    const metallic = getArchetypeGeometries('metallic', count, detail, radius)

    // Массивы разные
    expect(stony).not.toBe(carbonaceous)
    expect(stony).not.toBe(metallic)
    expect(carbonaceous).not.toBe(metallic)

    // Элементы по одному индексу разные между профилями
    const stoPos = stony[0].getAttribute('position')
    const carPos = carbonaceous[0].getAttribute('position')
    const mePos = metallic[0].getAttribute('position')

    // Проверяем первые 30 позиций (или все, если их меньше)
    const checkCount = Math.min(30, stoPos.count)
    const stoArray = Array.from(stoPos.array as Float32Array).slice(0, checkCount * 3)
    const carArray = Array.from(carPos.array as Float32Array).slice(0, checkCount * 3)
    const meArray = Array.from(mePos.array as Float32Array).slice(0, checkCount * 3)

    expect(stoArray).not.toEqual(carArray)
    expect(stoArray).not.toEqual(meArray)
    expect(carArray).not.toEqual(meArray)
  })

  // (4) Архетип k=0 побитово равен геометрии buildArchetypeGeometry из 2a
  it('архетип k=0 совпадает с единственным архетипом из 2a (преемственность)', () => {
    const profile: AsteroidProfileName = 'stony'
    const detail = 2
    const radius = 0.1

    // Получаем первый архетип из библиотеки
    const lib = getArchetypeGeometries(profile, 1, detail, radius)
    const libGeom = lib[0]

    // Воссоздаём то же вручную как в 2a
    const profileIndex = Object.keys(ASTEROID_PROFILES).indexOf(profile)
    const rng = new SeededRandom(hashSectorKey(0xa57, 0, profileIndex))
    const shape = new ArchetypeShape(generateArchetypeParams(rng))
    const expectedGeom = buildArchetypeGeometry(shape, detail, radius)

    // Проверяем побитовое равенство позиций
    const libPos = libGeom.getAttribute('position')
    const expPos = expectedGeom.getAttribute('position')

    expect(libPos.count).toBe(expPos.count)
    const libArray = Array.from(libPos.array as Float32Array)
    const expArray = Array.from(expPos.array as Float32Array)
    expect(libArray).toEqual(expArray)

    // Проверяем нормали
    const libNor = libGeom.getAttribute('normal')
    const expNor = expectedGeom.getAttribute('normal')
    const libNorArray = Array.from(libNor.array as Float32Array)
    const expNorArray = Array.from(expNor.array as Float32Array)
    expect(libNorArray).toEqual(expNorArray)
  })

  // (5) Детерминизм между вызовами с разными count: сид k-го архетипа не
  // зависит от count (проверяем воспроизведение по seed), НО с задачи 3
  // морфология k-го архетипа определяется через morphologyForIndex(profile, k, count)
  // — она зависит от count, поэтому геометрия одного k при разных count
  // совпадает только там, где выбранная морфология совпадает (см. также
  // блок describe('morphologyForIndex') ниже).
  it('первые K геометрий из count=16 и count=12 воспроизводимы по сиду+морфологии своего count', () => {
    const profile: AsteroidProfileName = 'stony'
    const detail = 2
    const radius = 0.1

    const lib16 = getArchetypeGeometries(profile, 16, detail, radius)
    const lib12 = getArchetypeGeometries(profile, 12, detail, radius)

    const profileIndex = Object.keys(ASTEROID_PROFILES).indexOf(profile)

    for (let k = 0; k < 12; k++) {
      const seed = hashSectorKey(0xa57, k, profileIndex)

      const rng16 = new SeededRandom(seed)
      const shape16 = new ArchetypeShape(generateArchetypeParams(rng16, morphologyForIndex(profile, k, 16)))
      const expected16 = buildArchetypeGeometry(shape16, detail, radius)

      const rng12 = new SeededRandom(seed)
      const shape12 = new ArchetypeShape(generateArchetypeParams(rng12, morphologyForIndex(profile, k, 12)))
      const expected12 = buildArchetypeGeometry(shape12, detail, radius)

      const geom16Pos = Array.from(lib16[k].getAttribute('position').array as Float32Array)
      const geom12Pos = Array.from(lib12[k].getAttribute('position').array as Float32Array)

      expect(geom16Pos).toEqual(Array.from(expected16.getAttribute('position').array as Float32Array))
      expect(geom12Pos).toEqual(Array.from(expected12.getAttribute('position').array as Float32Array))

      // Там, где морфология для этого k совпадает между count=16 и count=12
      // (обе библиотеки согласны, какая это порода камня), геометрии
      // по-прежнему идентичны — усечение библиотеки не «пере жёвывает» форму.
      if (morphologyForIndex(profile, k, 16) === morphologyForIndex(profile, k, 12)) {
        expect(geom16Pos).toEqual(geom12Pos)
      }
    }
  })
})

describe('morphologyForIndex: пороговое разбиение архетипов по весам профиля', () => {
  // (1) K=14, stony: округление даёт 8 fragment / 4 rubble / 2 cratered
  // (round(14·0.6)=8, round(14·0.85)=12 ⇒ rubble=12-8=4, cratered=14-12=2)
  it('stony K=14: 8 fragment, 4 rubble, 2 cratered', () => {
    const counts = { fragment: 0, rubble: 0, cratered: 0 }
    for (let k = 0; k < 14; k++) {
      counts[morphologyForIndex('stony', k, 14)]++
    }
    expect(counts).toEqual({ fragment: 8, rubble: 4, cratered: 2 })
  })

  // (2) k=0 — всегда fragment для любого профиля (преемственность 2a/2b)
  it('k=0 всегда fragment для всех профилей', () => {
    const profiles: AsteroidProfileName[] = ['stony', 'carbonaceous', 'metallic', 'icy']
    for (const profile of profiles) {
      for (const count of [1, 2, 3, 5, 14, 16]) {
        expect(morphologyForIndex(profile, 0, count)).toBe('fragment')
      }
    }
  })

  // (3) K=3: каждая морфология (вес > 0 у всех 4 профилей) представлена хотя бы раз
  it('K=3: каждая морфология представлена хотя бы одним k для всех профилей', () => {
    const profiles: AsteroidProfileName[] = ['stony', 'carbonaceous', 'metallic', 'icy']
    for (const profile of profiles) {
      const seen = new Set<string>()
      for (let k = 0; k < 3; k++) {
        seen.add(morphologyForIndex(profile, k, 3))
      }
      expect(seen).toEqual(new Set(['fragment', 'rubble', 'cratered']))
    }
  })
})

describe('getArchetypeGeometries: геометрии разных морфологий различаются', () => {
  it('fragment/rubble/cratered архетипы одного профиля попарно различны', () => {
    const detail = 2
    const radius = 0.1
    // K=3 у stony гарантированно даёт по одному архетипу каждой морфологии
    // (см. morphologyForIndex K=3), поэтому k=0,1,2 — fragment, rubble, cratered.
    const geoms = getArchetypeGeometries('stony', 3, detail, radius)
    expect(morphologyForIndex('stony', 0, 3)).toBe('fragment')
    expect(morphologyForIndex('stony', 1, 3)).toBe('rubble')
    expect(morphologyForIndex('stony', 2, 3)).toBe('cratered')

    const checkCount = Math.min(30, geoms[0].getAttribute('position').count)
    const posArrays = geoms.map((g) =>
      Array.from(g.getAttribute('position').array as Float32Array).slice(0, checkCount * 3)
    )

    for (let i = 0; i < posArrays.length; i++) {
      for (let j = i + 1; j < posArrays.length; j++) {
        expect(posArrays[i]).not.toEqual(posArrays[j])
      }
    }
  })
})
