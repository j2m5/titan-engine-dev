import { describe, it, expect } from 'vitest'
import { deriveCascades, PIXEL_RAD } from '@/core/renderables/DetailedRingStreamingSystem/cascadeScale'
import { assertLodInvariant } from '@/core/renderables/DetailedRingStreamingSystem/streamerScale'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { AU } from '@/core/constants'

/** Стартовые ручки пояса: полутолщина 0.05 а.е., шаг мелкого класса 54 км */
const HALF_THICKNESS_KM = 0.05 * AU
const belt = () => deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 54, halfThicknessKm: HALF_THICKNESS_KM })

describe('deriveCascades: полосы размеров', () => {
  it('три класса геометрическими полосами, стык без дыр', () => {
    const c = belt()
    expect(c).toHaveLength(3)
    expect(c[0].sizeRangeKm[0]).toBeCloseTo(0.5, 6)
    expect(c[2].sizeRangeKm[1]).toBeCloseTo(60, 6)
    expect(c[0].sizeRangeKm[1]).toBeCloseTo(c[1].sizeRangeKm[0], 6)
    expect(c[1].sizeRangeKm[1]).toBeCloseTo(c[2].sizeRangeKm[0], 6)
  })

  it('окно множителя отсчитывается от общего габарита — верха диапазона', () => {
    const c = belt()
    expect(c[2].maxScale).toBeCloseTo(1, 6)
    expect(c[0].minScale).toBeCloseTo(0.5 / 60, 6)
    expect(c[0].maxScale).toBeCloseTo(c[0].sizeRangeKm[1] / 60, 6)
  })
})

describe('deriveCascades: радиус, шаг и густота', () => {
  it('радиус заселения — дистанция одного пикселя для типичного тела класса', () => {
    for (const c of belt()) {
      expect(c.populationRadiusKm).toBeCloseTo(c.typicalSizeKm / PIXEL_RAD, 6)
    }
  })

  it('шаг растёт пропорционально размеру — угловая густота одинакова у всех классов', () => {
    const c = belt()
    expect(c[0].spacingKm).toBeCloseTo(54, 6)
    for (const spec of c) {
      expect(spec.spacingKm / spec.typicalSizeKm).toBeCloseTo(c[0].spacingKm / c[0].typicalSizeKm, 6)
    }
  })

  it('спрос на экземпляры одинаков у каскадов и заполняет треть пула', () => {
    const c = belt()
    for (const spec of c) expect(spec.instanceDemand).toBeCloseTo(c[0].instanceDemand, -2)
    // Пул стримера ~205 тысяч на три каскада
    expect(c[0].instanceDemand).toBeGreaterThan(55000)
    expect(c[0].instanceDemand).toBeLessThan(80000)
  })

  it('вдвое меньший шаг требует восьмикратно больше экземпляров', () => {
    const dense = deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 27, halfThicknessKm: HALF_THICKNESS_KM })
    expect(dense[0].instanceDemand / belt()[0].instanceDemand).toBeCloseTo(8, 1)
  })
})

describe('deriveCascades: плотность несёт полутолщину', () => {
  it('число тел в ячейке средней плоскости даёт объёмный шаг, а не плоский', () => {
    for (const spec of belt()) {
      const cellTu = toThreeJSUnits(spec.cellSizeKm)
      const halfTu = toThreeJSUnits(HALF_THICKNESS_KM)
      // Сетка множит плотность на площадь сектора и на долю вертикального
      // профиля; у ячейки в средней плоскости доля ≈ высота ячейки / полутолщина
      const inCell = cellTu * cellTu * spec.densityPerUnit * (cellTu / halfTu)
      const expected = Math.pow(spec.cellSizeKm / spec.spacingKm, 3)

      expect(inCell).toBeCloseTo(expected, -1)
    }
  })

  it('толще пояс — гуще плотность на площадь, объёмный шаг не меняется', () => {
    const thin = deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 54, halfThicknessKm: HALF_THICKNESS_KM })
    const thick = deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 54, halfThicknessKm: HALF_THICKNESS_KM * 4 })

    expect(thick[0].densityPerUnit / thin[0].densityPerUnit).toBeCloseTo(4, 6)
    expect(thick[0].spacingKm).toBeCloseTo(thin[0].spacingKm, 6)
    expect(thick[0].instanceDemand).toBe(thin[0].instanceDemand)
  })
})

describe('deriveCascades: пороги тиров', () => {
  it('пороги — доли радиуса заселения, а не углового размера тела', () => {
    for (const spec of belt()) {
      const r = spec.populationRadiusKm
      expect(spec.lodThresholdsKm.l1).toBeCloseTo(r, 6)
      expect(spec.lodThresholdsKm.l0).toBeCloseTo(r * 0.5, 6)
      expect(spec.lodThresholdsKm.l0Near).toBeCloseTo(r * 0.208, 6)
      expect(spec.lodThresholdsKm.l0NearExit).toBeCloseTo(r * 0.267, 6)
      expect(spec.lodThresholdsKm.l0NearExit).toBeGreaterThan(spec.lodThresholdsKm.l0Near)
    }
  })

  it('ячейка — доля радиуса, высота ячейки равна ширине', () => {
    for (const spec of belt()) {
      expect(spec.cellSizeKm).toBeCloseTo(spec.populationRadiusKm / 5, 6)
      expect(spec.cellHeightKm).toBeCloseTo(spec.cellSizeKm, 6)
    }
  })

  it('инвариант LOD выполняется у каждого каскада при любом шаге', () => {
    for (const spacingKm of [20, 54, 120, 400]) {
      const specs = deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm, halfThicknessKm: HALF_THICKNESS_KM })
      for (const spec of specs) {
        expect(() => assertLodInvariant(spec.cellSizeKm, spec.lodThresholdsKm)).not.toThrow()
      }
    }
  })

  it('ближний тир достижим: порог входа больше полудиагонали ячейки', () => {
    for (const spec of belt()) {
      expect(spec.lodThresholdsKm.l0Near).toBeGreaterThan(spec.cellSizeKm * Math.SQRT1_2)
    }
  })
})
