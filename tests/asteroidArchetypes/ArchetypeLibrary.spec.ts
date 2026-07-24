import { getArchetypeGeometries } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary'
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

  // (5) Детерминизм между вызовами с разными count
  it('первые K геометрий из count=16 и count=12 идентичны для k<12', () => {
    const profile: AsteroidProfileName = 'stony'
    const detail = 2
    const radius = 0.1

    const lib16 = getArchetypeGeometries(profile, 16, detail, radius)
    const lib12 = getArchetypeGeometries(profile, 12, detail, radius)

    // Первые 12 элементов должны быть идентичны по сидам и геометрии
    const profileIndex = Object.keys(ASTEROID_PROFILES).indexOf(profile)

    for (let k = 0; k < 12; k++) {
      // Проверяем по сидам: оба должны быть созданы с одинаковым сидом
      const seed = hashSectorKey(0xa57, k, profileIndex)
      const rng = new SeededRandom(seed)
      const shape = new ArchetypeShape(generateArchetypeParams(rng))
      const expected = buildArchetypeGeometry(shape, detail, radius)

      const geom16 = lib16[k]
      const geom12 = lib12[k]

      // Обе должны совпадать с ожидаемой
      const geom16Pos = Array.from(geom16.getAttribute('position').array as Float32Array)
      const geom12Pos = Array.from(geom12.getAttribute('position').array as Float32Array)
      const expectedPos = Array.from(expected.getAttribute('position').array as Float32Array)

      expect(geom16Pos).toEqual(expectedPos)
      expect(geom12Pos).toEqual(expectedPos)
    }
  })
})
