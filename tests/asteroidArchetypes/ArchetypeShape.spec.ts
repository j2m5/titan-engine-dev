import {
  ArchetypeShape,
  generateArchetypeParams
} from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeShape'
import { SeededRandom } from '@/core/renderables/DetailedRingStreamingSystem/SeededRandom'
import { IcosahedronGeometry } from 'three'

/** Направления вершин икосферы — стандартная сетка сэмплов по сфере */
const sphereDirs = (detail: number): Array<[number, number, number]> => {
  const pos = new IcosahedronGeometry(1, detail).getAttribute('position')
  const dirs: Array<[number, number, number]> = []
  for (let i = 0; i < pos.count; i++) {
    const len = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))
    dirs.push([pos.getX(i) / len, pos.getY(i) / len, pos.getZ(i) / len])
  }
  return dirs
}

describe('generateArchetypeParams: детерминизм и диапазоны (морфология A)', () => {
  it('одинаковый сид → побитово одинаковые параметры', () => {
    const a = generateArchetypeParams(new SeededRandom(42))
    const b = generateArchetypeParams(new SeededRandom(42))
    expect(a).toEqual(b)
  })

  it('разные сиды → разные наборы плоскостей', () => {
    const a = generateArchetypeParams(new SeededRandom(1))
    const b = generateArchetypeParams(new SeededRandom(2))
    expect(a.planes).not.toEqual(b.planes)
  })

  it('диапазоны спеки: 6–12 плоскостей, единичные нормали, оси нормированы на объём', () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = generateArchetypeParams(new SeededRandom(seed))
      expect(p.planes.length).toBeGreaterThanOrEqual(6)
      expect(p.planes.length).toBeLessThanOrEqual(12)
      for (const plane of p.planes) {
        expect(Math.hypot(...plane.normal)).toBeCloseTo(1, 6)
        expect(plane.distance).toBeGreaterThan(0) // начало внутри → звёздность
      }
      // ∛(x·y·z) = 1 — нормировка объёма сохраняет распределение масштабов
      expect(Math.cbrt(p.axes[0] * p.axes[1] * p.axes[2])).toBeCloseTo(1, 6)
    }
  })
})

describe('ArchetypeShape.radiusAt: свойства радиальной функции', () => {
  it('звёздность и нормализация генерализуются на чужую сетку (икосфера)', () => {
    // ВАЖНО: сетка теста (икосфера detail 3) НАМЕРЕННО не совпадает с сеткой
    // нормализации (спираль Фибоначчи 512) — на той же сетке max = 1 по
    // построению и тест тавтологичен. Расхождение max между сетками измерено
    // эмпирически: до ±2–5% (сиды 0..29: max по икосфере ∈ [0.947, 1.021]).
    // Допуски ниже — честная граница генерализации, не ослабление: слом
    // нормализации (множитель не применён / посчитан не той функцией) даёт ~1.4+.
    for (let seed = 0; seed < 10; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed)))
      let max = 0
      for (const [x, y, z] of sphereDirs(3)) {
        const r = shape.radiusAt(x, y, z)
        expect(r).toBeGreaterThan(0.15)
        expect(r).toBeLessThanOrEqual(1.03)
        if (r > max) max = r
      }
      expect(max).toBeGreaterThan(0.93)
    }
  })

  it('детерминизм: одинаковый сид → одинаковые радиусы', () => {
    const a = new ArchetypeShape(generateArchetypeParams(new SeededRandom(7)))
    const b = new ArchetypeShape(generateArchetypeParams(new SeededRandom(7)))
    for (const [x, y, z] of sphereDirs(1)) {
      expect(a.radiusAt(x, y, z)).toBe(b.radiusAt(x, y, z))
    }
  })

  it('чистый срез: одна плоскость без шума/излома кладёт точки на плоскость', () => {
    const shape = new ArchetypeShape({
      axes: [1, 1, 1],
      planes: [{ normal: [0, 1, 0], distance: 0.6, dish: 0 }],
      edgeRadius: 0, // жёсткий min — фасета математически плоская
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1 // без нормализации: проверяем геометрию среза как есть
    })
    // Направления «в фасету»: dot(dir, n) достаточно велик → побеждает плоскость
    for (const [x, y, z] of sphereDirs(2)) {
      if (y < 0.75) continue
      const r = shape.radiusAt(x, y, z)
      // Точка p = dir·r лежит на плоскости dot(p, n) = d
      expect(y * r).toBeCloseTo(0.6, 6)
    }
  })

  it('smooth-min консервативен: скруглённая кромка не выходит за жёсткий min', () => {
    const base = generateArchetypeParams(new SeededRandom(3))
    const hard = new ArchetypeShape({ ...base, edgeRadius: 0, noiseAmp: 0, normalization: 1 })
    const soft = new ArchetypeShape({ ...base, edgeRadius: 0.06, noiseAmp: 0, normalization: 1 })
    for (const [x, y, z] of sphereDirs(2)) {
      expect(soft.radiusAt(x, y, z)).toBeLessThanOrEqual(hard.radiusAt(x, y, z) + 1e-9)
    }
  })

  it('без плоскостей и шума радиусы по осям равны полуосям эллипсоида', () => {
    const shape = new ArchetypeShape({
      axes: [1.2, 0.9, 0.925925925925926], // ∛произведения ≈ 1
      planes: [],
      edgeRadius: 0.05,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1
    })
    expect(shape.radiusAt(1, 0, 0)).toBeCloseTo(1.2, 6)
    expect(shape.radiusAt(0, 1, 0)).toBeCloseTo(0.9, 6)
  })
})
