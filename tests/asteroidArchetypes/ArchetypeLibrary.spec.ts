import { getArchetypeGeometries, morphologyForIndex } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary'
import {
  ArchetypeShape,
  generateArchetypeParams
} from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeShape'
import { buildArchetypeGeometry } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeGeometry'
import { SeededRandom, hashSectorKey } from '@/core/renderables/DetailedRingStreamingSystem/SeededRandom'
import { ASTEROID_PROFILES, type AsteroidProfileName } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import type { LibraryCategory } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary'
import type { ArchetypeMorphology } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeShape'

/** Слот реальной модели запекается процедурной заглушкой-осколком (см. getArchetypeGeometries) */
const placeholderMorphology = (category: LibraryCategory): ArchetypeMorphology =>
  category === 'real' ? 'fragment' : category

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
      const shape16 = new ArchetypeShape(generateArchetypeParams(rng16, placeholderMorphology(morphologyForIndex(profile, k, 16))))
      const expected16 = buildArchetypeGeometry(shape16, detail, radius)

      const rng12 = new SeededRandom(seed)
      const shape12 = new ArchetypeShape(generateArchetypeParams(rng12, placeholderMorphology(morphologyForIndex(profile, k, 12))))
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
  // (1) K=14, stony: половина слотов — реальные модели (хвост), процедурная
  // голова из 7 по весам 0.5/0.2/0.1/0.05/0.15: ends 4, 5, 6, 6, 7 ⇒ 4/1/1/0/1,
  // правило «ненулевой вес — хотя бы один индекс» отдаёт top один у fragment
  it('stony K=14: 3 fragment, 1 rubble, 1 binary, 1 top, 1 cratered + 7 real', () => {
    const counts = { fragment: 0, rubble: 0, binary: 0, top: 0, cratered: 0, real: 0 }
    for (let k = 0; k < 14; k++) {
      counts[morphologyForIndex('stony', k, 14)]++
    }
    expect(counts).toEqual({ fragment: 3, rubble: 1, binary: 1, top: 1, cratered: 1, real: 7 })
  })

  // (1b) Только процедурная библиотека (override без реальных моделей):
  // ends 7, 10, 11, 12, 14 ⇒ 7 fragment / 3 rubble / 1 binary / 1 top / 2 cratered
  it('stony K=14 без реальных моделей: 7 fragment, 3 rubble, 1 binary, 1 top, 2 cratered', () => {
    const counts = { fragment: 0, rubble: 0, binary: 0, top: 0, cratered: 0, real: 0 }
    for (let k = 0; k < 14; k++) {
      counts[morphologyForIndex('stony', k, 14, { shapeModels: [], realShare: 0 })]++
    }
    expect(counts).toEqual({ fragment: 7, rubble: 3, binary: 1, top: 1, cratered: 2, real: 0 })
  })

  it('порядок категорий в библиотеке: fragment, rubble, binary, top, cratered, real — индексы контигуальны', () => {
    const order = ['fragment', 'rubble', 'binary', 'top', 'cratered', 'real']
    let last = -1
    for (let k = 0; k < 14; k++) {
      const idx = order.indexOf(morphologyForIndex('stony', k, 14))
      expect(idx).toBeGreaterThanOrEqual(last)
      last = idx
    }
  })

  it('metallic: вес top равен 0 → волчков в библиотеке нет', () => {
    for (let k = 0; k < 14; k++) expect(morphologyForIndex('metallic', k, 14)).not.toBe('top')
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

  // (3) K ≥ числу категорий с ненулевым весом: каждая такая категория представлена хотя бы раз
  it('K=5 без реальных моделей: каждая морфология с весом > 0 представлена хотя бы одним k', () => {
    const profiles: AsteroidProfileName[] = ['stony', 'carbonaceous', 'metallic', 'icy']
    for (const profile of profiles) {
      const w = ASTEROID_PROFILES[profile].morphologyWeights
      const expected = new Set(Object.entries(w).filter(([, v]) => v > 0).map(([m]) => m))
      const seen = new Set<string>()
      for (let k = 0; k < 5; k++) {
        seen.add(morphologyForIndex(profile, k, 5, { shapeModels: [], realShare: 0 }))
      }
      expect(seen).toEqual(expected)
    }
  })
})

describe('getArchetypeGeometries: геометрии разных морфологий различаются', () => {
  it('геометрии библиотеки попарно различны, слоты реальных моделей запечены осколками-заглушками', () => {
    const detail = 2
    const radius = 0.1
    // K=5 у stony: 2 процедурных слота + 3 слота реальных моделей; заглушки —
    // процедурные осколки со своими сидами, поэтому все пять геометрий разные
    const geoms = getArchetypeGeometries('stony', 5, detail, radius)
    const seen = new Set<string>()
    for (let k = 0; k < 5; k++) seen.add(morphologyForIndex('stony', k, 5))
    expect(seen.has('fragment')).toBe(true)
    expect(seen.has('real')).toBe(true)
    expect(geoms.length).toBe(5)

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
