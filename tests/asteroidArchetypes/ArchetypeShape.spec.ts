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
      normalization: 1, // без нормализации: проверяем геометрию среза как есть
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'fragment',
      lobes: [],
      craters: []
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
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'fragment',
      lobes: [],
      craters: []
    })
    expect(shape.radiusAt(1, 0, 0)).toBeCloseTo(1.2, 6)
    expect(shape.radiusAt(0, 1, 0)).toBeCloseTo(0.9, 6)
  })
})

describe('generateArchetypeParams: морфология B — rubble pile (слипшиеся эллипсоиды)', () => {
  it('3–7 лобов, пустые planes, инвариант |center| < min(axes) для каждого лоба', () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = generateArchetypeParams(new SeededRandom(seed), 'rubble')
      expect(p.morphology).toBe('rubble')
      expect(p.planes).toEqual([])
      expect(p.lobes.length).toBeGreaterThanOrEqual(3)
      expect(p.lobes.length).toBeLessThanOrEqual(7)
      for (const lobe of p.lobes) {
        const centerMag = Math.hypot(...lobe.center)
        const minAxis = Math.min(...lobe.axes)
        expect(centerMag).toBeLessThan(minAxis)
      }
    }
  })

  it('дефолт без второго аргумента — морфология fragment (обратная совместимость)', () => {
    const p = generateArchetypeParams(new SeededRandom(5))
    expect(p.morphology).toBe('fragment')
    expect(p.lobes).toEqual([])
  })

  it('одинаковый сид → побитово одинаковые параметры (детерминизм)', () => {
    const a = generateArchetypeParams(new SeededRandom(42), 'rubble')
    const b = generateArchetypeParams(new SeededRandom(42), 'rubble')
    expect(a).toEqual(b)
  })
})

describe('ArchetypeShape.radiusAt: морфология B — rubble pile', () => {
  it('звёздность и нормализация генерализуются на чужую сетку (икосфера)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed), 'rubble'))
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
    const a = new ArchetypeShape(generateArchetypeParams(new SeededRandom(7), 'rubble'))
    const b = new ArchetypeShape(generateArchetypeParams(new SeededRandom(7), 'rubble'))
    for (const [x, y, z] of sphereDirs(1)) {
      expect(a.radiusAt(x, y, z)).toBe(b.radiusAt(x, y, z))
    }
  })

  it('один лоб без шума с центром в нуле → чистый эллипсоид (радиусы по осям = полуоси лоба)', () => {
    const shape = new ArchetypeShape({
      axes: [1, 1, 1],
      planes: [],
      lobes: [{ center: [0, 0, 0], axes: [1.2, 0.9, 0.7] }],
      craters: [],
      edgeRadius: 0.15,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'rubble'
    })
    expect(shape.radiusAt(1, 0, 0)).toBeCloseTo(1.2, 6)
    expect(shape.radiusAt(0, 1, 0)).toBeCloseTo(0.9, 6)
    expect(shape.radiusAt(0, 0, 1)).toBeCloseTo(0.7, 6)
  })

  it('два разнесённых лоба дают «талию»: перпендикуляр к линии центров даёт меньший радиус, чем вдоль неё', () => {
    const shape = new ArchetypeShape({
      axes: [1, 1, 1],
      planes: [],
      lobes: [
        { center: [0.2, 0, 0], axes: [0.6, 0.6, 0.6] },
        { center: [-0.2, 0, 0], axes: [0.6, 0.6, 0.6] }
      ],
      craters: [],
      edgeRadius: 0, // жёсткий max — сравнение геометрии без сглаживания
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'rubble'
    })
    const along = shape.radiusAt(1, 0, 0) // вдоль линии центров лобов
    const across = shape.radiusAt(0, 1, 0) // перпендикуляр — «талия»
    expect(across).toBeLessThan(along)
  })
})

describe('generateArchetypeParams: морфология C — кратерный монолит (силуэт-кратеры)', () => {
  it('2–5 кратеров, единичные центры, диапазоны angularRadius/depth, planes/lobes пустые, noiseAmp в диапазоне', () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = generateArchetypeParams(new SeededRandom(seed), 'cratered')
      expect(p.morphology).toBe('cratered')
      expect(p.planes).toEqual([])
      expect(p.lobes).toEqual([])
      expect(p.craters.length).toBeGreaterThanOrEqual(2)
      expect(p.craters.length).toBeLessThanOrEqual(5)
      for (const crater of p.craters) {
        expect(Math.hypot(...crater.center)).toBeCloseTo(1, 6)
        expect(crater.angularRadius).toBeGreaterThanOrEqual(0.25)
        expect(crater.angularRadius).toBeLessThanOrEqual(0.5)
        expect(crater.depth).toBeGreaterThanOrEqual(0.08)
        expect(crater.depth).toBeLessThanOrEqual(0.18)
      }
      expect(p.noiseAmp).toBeGreaterThanOrEqual(0.05)
      expect(p.noiseAmp).toBeLessThanOrEqual(0.08)
    }
  })

  it('одинаковый сид → побитово одинаковые параметры (детерминизм)', () => {
    const a = generateArchetypeParams(new SeededRandom(42), 'cratered')
    const b = generateArchetypeParams(new SeededRandom(42), 'cratered')
    expect(a).toEqual(b)
  })
})

describe('ArchetypeShape.surfaceAt: freshness (только морфология A)', () => {
  it('freshness ≈ 1 в центре фасеты (плоскость победила с запасом), 0 там, где плоскость не режет (эллипсоид)', () => {
    const shape = new ArchetypeShape({
      axes: [1, 1, 1],
      planes: [{ normal: [0, 1, 0], distance: 0.6, dish: 0 }],
      edgeRadius: 0.05,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'fragment',
      lobes: [],
      craters: []
    })
    // dot(dir, normal) = 1, rPlane = 0.6, rEll = 1 → margin 0.4 >> edgeRadius
    expect(shape.surfaceAt(0, 1, 0).freshness).toBeCloseTo(1, 6)
    // dot(dir, normal) = -1 <= 1e-6 → плоскость не рассматривается, побеждает эллипсоид
    expect(shape.surfaceAt(0, -1, 0).freshness).toBe(0)
  })

  it('линейный переход в полосе ±edgeRadius вокруг равенства rEll и rPlane', () => {
    // Подбираем direction так, чтобы margin был примерно на полпути в полосе:
    // rEll=1 (axes единичные), нужен rPlane = rEll - edgeRadius/2 → margin=edgeRadius/2
    const edgeRadius = 0.1
    const distance = 1 - edgeRadius / 2 // на dir=(0,1,0): rPlane = distance
    const shape = new ArchetypeShape({
      axes: [1, 1, 1],
      planes: [{ normal: [0, 1, 0], distance, dish: 0 }],
      edgeRadius,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'fragment',
      lobes: [],
      craters: []
    })
    const f = shape.surfaceAt(0, 1, 0).freshness
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThan(1)
    expect(f).toBeCloseTo(0.75, 6) // clamp(0.5 + 0.5*margin/edgeRadius, 0, 1) = 0.5+0.5*0.5 = 0.75
  })

  it('cavity всегда 0 у морфологии A (freshness — не cavity)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed)))
      for (const [x, y, z] of sphereDirs(2)) {
        expect(shape.surfaceAt(x, y, z).cavity).toBe(0)
      }
    }
  })

  it('freshness всегда в [0,1] на случайных архетипах и направлениях', () => {
    for (let seed = 0; seed < 10; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed)))
      for (const [x, y, z] of sphereDirs(2)) {
        const f = shape.surfaceAt(x, y, z).freshness
        expect(f).toBeGreaterThanOrEqual(0)
        expect(f).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('ArchetypeShape.surfaceAt: rubble — оба сигнала нулевые', () => {
  it('freshness и cavity равны 0 всюду (морфология B)', () => {
    for (let seed = 0; seed < 5; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed), 'rubble'))
      for (const [x, y, z] of sphereDirs(1)) {
        const s = shape.surfaceAt(x, y, z)
        expect(s.freshness).toBe(0)
        expect(s.cavity).toBe(0)
      }
    }
  })
})

describe('ArchetypeShape.surfaceAt: cavity (только морфология C)', () => {
  it('cavity > 0.3 в центре кратера, 0 вдали и на валу (u ≈ 0.9)', () => {
    const depth = 0.15
    const angularRadius = 0.3
    const shape = new ArchetypeShape({
      axes: [1, 1, 1],
      planes: [],
      lobes: [],
      craters: [{ center: [0, 0, 1], angularRadius, depth }],
      edgeRadius: 0,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'cratered'
    })
    expect(shape.surfaceAt(0, 0, 1).cavity).toBeGreaterThan(0.3)
    // Противоположный полюс: вне углового радиуса кратера (u > 1) — далеко
    expect(shape.surfaceAt(0, 0, -1).cavity).toBe(0)
    // На валу: u ≈ 0.9 — craterProfile положителен (rim), вклад в chasm = 0
    const u = 0.9
    const cosTheta = 1 - u * angularRadius
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
    expect(shape.surfaceAt(sinTheta, 0, cosTheta).cavity).toBe(0)
  })

  it('freshness всегда 0 у морфологии C', () => {
    for (let seed = 0; seed < 10; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed), 'cratered'))
      for (const [x, y, z] of sphereDirs(2)) {
        expect(shape.surfaceAt(x, y, z).freshness).toBe(0)
      }
    }
  })

  it('cavity всегда в [0,1] на случайных архетипах и направлениях', () => {
    for (let seed = 0; seed < 10; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed), 'cratered'))
      for (const [x, y, z] of sphereDirs(2)) {
        const c = shape.surfaceAt(x, y, z).cavity
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('ArchetypeShape.radiusAt === surfaceAt(...).r для всех морфологий', () => {
  it('обратная совместимость radiusAt: одно и то же значение r', () => {
    const morphologies: Array<'fragment' | 'rubble' | 'cratered'> = ['fragment', 'rubble', 'cratered']
    for (const morphology of morphologies) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(3), morphology))
      for (const [x, y, z] of sphereDirs(1)) {
        expect(shape.radiusAt(x, y, z)).toBe(shape.surfaceAt(x, y, z).r)
      }
    }
  })
})

describe('ArchetypeShape.radiusAt: морфология C — кратерный монолит', () => {
  it('звёздность и нормализация генерализуются на чужую сетку (икосфера)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed), 'cratered'))
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
    const a = new ArchetypeShape(generateArchetypeParams(new SeededRandom(7), 'cratered'))
    const b = new ArchetypeShape(generateArchetypeParams(new SeededRandom(7), 'cratered'))
    for (const [x, y, z] of sphereDirs(1)) {
      expect(a.radiusAt(x, y, z)).toBe(b.radiusAt(x, y, z))
    }
  })

  it('кратер реально врезан: в ε-окрестности центра депрессия ≥ 0.6·depth относительно формы без кратеров', () => {
    const depth = 0.15
    const shape = new ArchetypeShape({
      axes: [1, 1, 1],
      planes: [],
      lobes: [],
      craters: [{ center: [0, 0, 1], angularRadius: 0.3, depth }],
      edgeRadius: 0,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'cratered'
    })
    // База без кратеров: единичный эллипсоид, r(0,0,1) = 1 (та же ось axes=[1,1,1])
    const rBase = 1
    const rCenter = shape.radiusAt(0, 0, 1) // ровно в центре кратера, u = 0
    expect(rBase - rCenter).toBeGreaterThanOrEqual(0.6 * depth - 1e-9)
  })

  it('вал: на u ≈ 0.9 радиус чуть больше базового (rim positive)', () => {
    const depth = 0.15
    const angularRadius = 0.3
    const shape = new ArchetypeShape({
      axes: [1, 1, 1],
      planes: [],
      lobes: [],
      craters: [{ center: [0, 0, 1], angularRadius, depth }],
      edgeRadius: 0,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'cratered'
    })
    // Направление на угловом расстоянии u=0.9·angularRadius от центра [0,0,1]:
    // dot(dir, center) = cos(theta) = 1 - u·angularRadius (см. rawRadius: u = (1-dot)/angularRadius)
    const u = 0.9
    const cosTheta = 1 - u * angularRadius
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
    const rRim = shape.radiusAt(sinTheta, 0, cosTheta)
    const rBase = 1
    expect(rRim).toBeGreaterThan(rBase)
  })

  it('за краем кратера (u > 1) база не тронута — радиус равен эллипсоиду без кратеров', () => {
    const angularRadius = 0.3
    const shapeWithCrater = new ArchetypeShape({
      axes: [1.2, 0.9, 0.925925925925926],
      planes: [],
      lobes: [],
      craters: [{ center: [0, 0, 1], angularRadius, depth: 0.15 }],
      edgeRadius: 0,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'cratered'
    })
    const shapeNoCrater = new ArchetypeShape({
      axes: [1.2, 0.9, 0.925925925925926],
      planes: [],
      lobes: [],
      craters: [],
      edgeRadius: 0,
      noiseAmp: 0,
      noiseFreq: 3,
      seed: 1,
      normalization: 1,
      ridgeAmp: 0,
      ridgeWidth: 0,
      morphology: 'cratered'
    })
    // u = 1.1 > 1 → направление строго за краем кратера
    const u = 1.1
    const cosTheta = 1 - u * angularRadius
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
    expect(shapeWithCrater.radiusAt(sinTheta, 0, cosTheta)).toBeCloseTo(
      shapeNoCrater.radiusAt(sinTheta, 0, cosTheta),
      9
    )
  })
})

describe('generateArchetypeParams: морфология D — контактная двойная (binary)', () => {
  it('ровно два лоба на оси X, начало координат внутри каждого, лобы разного размера', () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = generateArchetypeParams(new SeededRandom(seed), 'binary')
      expect(p.morphology).toBe('binary')
      expect(p.planes).toEqual([])
      expect(p.craters).toEqual([])
      expect(p.lobes.length).toBe(2)
      const [big, small] = p.lobes
      // Разведены по X в разные стороны — перемычка между ними
      expect(big.center[0]).toBeGreaterThan(0)
      expect(small.center[0]).toBeLessThan(0)
      expect(big.center[1]).toBe(0)
      expect(big.center[2]).toBe(0)
      // Начало внутри лоба: Σ (c/axes)² < 1 — звёздность каждого лоба и объединения
      for (const lobe of p.lobes) {
        const inside =
          (lobe.center[0] / lobe.axes[0]) ** 2 + (lobe.center[1] / lobe.axes[1]) ** 2 + (lobe.center[2] / lobe.axes[2]) ** 2
        expect(inside).toBeLessThan(1)
        // Центр разведён заметно: не меньше 55% полуоси вдоль X (иначе это rubble, а не двойная)
        expect(Math.abs(lobe.center[0]) / lobe.axes[0]).toBeGreaterThanOrEqual(0.55 - 1e-9)
      }
      // Голова меньше тела: отношение полуосей 0.6–0.9
      const ratio = small.axes[0] / big.axes[0]
      expect(ratio).toBeGreaterThanOrEqual(0.6 - 1e-9)
      expect(ratio).toBeLessThanOrEqual(0.9 + 1e-9)
    }
  })

  it('одинаковый сид → побитово одинаковые параметры (детерминизм)', () => {
    expect(generateArchetypeParams(new SeededRandom(7), 'binary')).toEqual(
      generateArchetypeParams(new SeededRandom(7), 'binary')
    )
  })
})

describe('ArchetypeShape.radiusAt: морфология D — контактная двойная', () => {
  it('звёздность и нормализация генерализуются на чужую сетку (икосфера)', () => {
    for (let seed = 0; seed < 8; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed), 'binary'))
      let max = 0
      for (const [x, y, z] of sphereDirs(3)) {
        const r = shape.radiusAt(x, y, z)
        expect(r).toBeGreaterThan(0)
        expect(r).toBeLessThanOrEqual(1.03)
        if (r > max) max = r
      }
      expect(max).toBeGreaterThan(0.95)
    }
  })

  it('перемычка: радиус поперёк оси в плоскости шейки меньше радиуса вдоль оси и радиусов над центрами лобов', () => {
    for (let seed = 0; seed < 8; seed++) {
      const params = generateArchetypeParams(new SeededRandom(seed), 'binary')
      const shape = new ArchetypeShape({ ...params, noiseAmp: 0 })
      const alongPlus = shape.radiusAt(1, 0, 0)
      const alongMinus = shape.radiusAt(-1, 0, 0)
      const neckY = shape.radiusAt(0, 1, 0)
      const neckZ = shape.radiusAt(0, 0, 1)
      expect(neckY).toBeLessThan(alongPlus)
      expect(neckY).toBeLessThan(alongMinus)
      expect(neckZ).toBeLessThan(alongPlus)
      // Тело (большой лоб, +X) дальше от центра, чем голова (−X)
      expect(alongPlus).toBeGreaterThan(alongMinus)
    }
  })
})

describe('generateArchetypeParams: морфология E — волчок (top, экваториальный гребень)', () => {
  it('сплюснутый эллипсоид с полярной осью Y и гребнем в диапазонах', () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = generateArchetypeParams(new SeededRandom(seed), 'top')
      expect(p.morphology).toBe('top')
      expect(p.planes).toEqual([])
      expect(p.lobes).toEqual([])
      expect(p.craters).toEqual([])
      // Экваториальные полуоси равны, полярная меньше
      expect(p.axes[0]).toBe(p.axes[2])
      expect(p.axes[1]).toBeLessThan(p.axes[0])
      expect(p.ridgeAmp).toBeGreaterThanOrEqual(0.06 - 1e-9)
      expect(p.ridgeAmp).toBeLessThanOrEqual(0.14 + 1e-9)
      expect(p.ridgeWidth).toBeGreaterThan(0)
    }
  })

  it('морфологии A/B/C несут нулевой гребень', () => {
    for (const m of ['fragment', 'rubble', 'cratered'] as const) {
      const p = generateArchetypeParams(new SeededRandom(3), m)
      expect(p.ridgeAmp).toBe(0)
    }
  })
})

describe('ArchetypeShape.radiusAt: морфология E — волчок', () => {
  it('звёздность и нормализация генерализуются на чужую сетку (икосфера)', () => {
    for (let seed = 0; seed < 8; seed++) {
      const shape = new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed), 'top'))
      let max = 0
      for (const [x, y, z] of sphereDirs(3)) {
        const r = shape.radiusAt(x, y, z)
        expect(r).toBeGreaterThan(0)
        expect(r).toBeLessThanOrEqual(1.03)
        if (r > max) max = r
      }
      expect(max).toBeGreaterThan(0.95)
    }
  })

  it('гребень: экватор шире эллипсоида без гребня, широта 30° и полюс — нет', () => {
    for (let seed = 0; seed < 8; seed++) {
      const params = generateArchetypeParams(new SeededRandom(seed), 'top')
      const ridged = new ArchetypeShape({ ...params, noiseAmp: 0, normalization: 1 })
      const plain = new ArchetypeShape({ ...params, noiseAmp: 0, ridgeAmp: 0, normalization: 1 })
      const eqRatio = ridged.radiusAt(1, 0, 0) / plain.radiusAt(1, 0, 0)
      expect(eqRatio).toBeCloseTo(1 + params.ridgeAmp, 6)
      const lat30 = Math.sin(Math.PI / 6)
      const cos30 = Math.cos(Math.PI / 6)
      const midRatio = ridged.radiusAt(cos30, lat30, 0) / plain.radiusAt(cos30, lat30, 0)
      expect(midRatio).toBeLessThan(eqRatio)
      expect(ridged.radiusAt(0, 1, 0)).toBeCloseTo(plain.radiusAt(0, 1, 0), 3)
      // Экватор — самое широкое место тела
      expect(ridged.radiusAt(1, 0, 0)).toBeGreaterThan(ridged.radiusAt(0, 1, 0))
    }
  })
})
