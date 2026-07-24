import { buildArchetypeGeometry } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeGeometry'
import {
  ArchetypeShape,
  generateArchetypeParams
} from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeShape'
import { SeededRandom } from '@/core/renderables/DetailedRingStreamingSystem/SeededRandom'
import { IcosahedronGeometry, Vector3 } from 'three'

const makeShape = (seed: number): ArchetypeShape =>
  new ArchetypeShape(generateArchetypeParams(new SeededRandom(seed)))

describe('buildArchetypeGeometry: запекание осколка', () => {
  it('та же тесселяция, что у IcosahedronGeometry той же детализации', () => {
    const geometry = buildArchetypeGeometry(makeShape(5), 3, 1)
    const reference = new IcosahedronGeometry(1, 3)
    expect(geometry.getAttribute('position').count).toBe(reference.getAttribute('position').count)
  })

  it('габарит: максимум |вершины| ≈ radius (допуск межсеточного расхождения), минимум > 0', () => {
    // Нормализация max=1 считается по спирали Фибоначчи 512; икосфера запекания —
    // другая сетка, эмпирическое межсеточное расхождение ±2–5% (замер ревью T1
    // по 30 сидам: max ∈ [0.947, 1.021]). Решение плана: overshoot ≤3% принят —
    // остаточная GPU-деформация и так ±6%, строгий r ≤ 1 ничему не нужен.
    const radius = 0.005
    const geometry = buildArchetypeGeometry(makeShape(5), 3, radius)
    const pos = geometry.getAttribute('position')
    let max = 0
    let min = Infinity
    for (let i = 0; i < pos.count; i++) {
      const len = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))
      if (len > max) max = len
      if (len < min) min = len
    }
    expect(max).toBeLessThanOrEqual(radius * 1.03)
    expect(max).toBeGreaterThan(radius * 0.9)
    expect(min).toBeGreaterThan(radius * 0.15)
  })

  it('нормали единичные и смотрят наружу (dot с направлением > 0)', () => {
    const geometry = buildArchetypeGeometry(makeShape(9), 2, 1)
    const pos = geometry.getAttribute('position')
    const nor = geometry.getAttribute('normal')
    for (let i = 0; i < nor.count; i++) {
      const n = new Vector3(nor.getX(i), nor.getY(i), nor.getZ(i))
      expect(n.length()).toBeCloseTo(1, 4)
      const d = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize()
      expect(n.dot(d)).toBeGreaterThan(0)
    }
  })

  it('нормали согласованы с геометрией: ≈ перпендикулярны касательной поверхности', () => {
    // Численная проверка: для вершины берём соседнюю точку поверхности по
    // касательному направлению — проекция шага на нормаль должна быть мала
    const shape = makeShape(11)
    const geometry = buildArchetypeGeometry(shape, 2, 1)
    const pos = geometry.getAttribute('position')
    const nor = geometry.getAttribute('normal')
    const eps = 1e-3
    let checked = 0
    for (let i = 0; i < pos.count && checked < 200; i += 7, checked++) {
      const d = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize()
      const t = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0).cross(d).normalize() : new Vector3(1, 0, 0).cross(d).normalize()
      const d2 = d.clone().addScaledVector(t, eps).normalize()
      const p1 = d.clone().multiplyScalar(shape.radiusAt(d.x, d.y, d.z))
      const p2 = d2.clone().multiplyScalar(shape.radiusAt(d2.x, d2.y, d2.z))
      const step = p2.sub(p1)
      const n = new Vector3(nor.getX(i), nor.getY(i), nor.getZ(i))
      // Шаг вдоль поверхности почти перпендикулярен нормали
      expect(Math.abs(step.normalize().dot(n))).toBeLessThan(0.35)
    }
  })

  it('детерминизм: одинаковый сид → побитово одинаковые позиции', () => {
    const a = buildArchetypeGeometry(makeShape(3), 2, 1).getAttribute('position')
    const b = buildArchetypeGeometry(makeShape(3), 2, 1).getAttribute('position')
    expect(Array.from(a.array as Float32Array)).toEqual(Array.from(b.array as Float32Array))
  })
})
