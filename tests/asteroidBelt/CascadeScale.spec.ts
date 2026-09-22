import { describe, it, expect } from 'vitest'
import { deriveCascades, PIXEL_RAD } from '@/core/renderables/DetailedRingStreamingSystem/cascadeScale'

const belt = () => deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 73 })

describe('deriveCascades', () => {
  it('три класса, геометрические полосы по размеру, стык без дыр', () => {
    const c = belt()
    expect(c).toHaveLength(3)
    expect(c[0].sizeRangeKm[0]).toBeCloseTo(0.5, 6)
    expect(c[2].sizeRangeKm[1]).toBeCloseTo(60, 6)
    expect(c[0].sizeRangeKm[1]).toBeCloseTo(c[1].sizeRangeKm[0], 6)
    expect(c[1].sizeRangeKm[1]).toBeCloseTo(c[2].sizeRangeKm[0], 6)
  })

  it('радиус заселения — дистанция одного пикселя для типичного тела класса', () => {
    for (const c of belt()) {
      expect(c.populationRadiusKm).toBeCloseTo(c.typicalSizeKm / PIXEL_RAD, 6)
    }
  })

  it('шаг растёт пропорционально размеру — угловая густота одинакова у всех классов', () => {
    const c = belt()
    expect(c[0].spacingKm).toBeCloseTo(73, 6)
    expect(c[1].spacingKm / c[1].typicalSizeKm).toBeCloseTo(c[0].spacingKm / c[0].typicalSizeKm, 6)
    expect(c[2].spacingKm / c[2].typicalSizeKm).toBeCloseTo(c[0].spacingKm / c[0].typicalSizeKm, 6)
  })

  it('спрос на экземпляры у всех каскадов одинаков', () => {
    const [a, b, d] = belt()
    expect(b.instanceDemand).toBeCloseTo(a.instanceDemand, -2)
    expect(d.instanceDemand).toBeCloseTo(a.instanceDemand, -2)
    expect(a.instanceDemand).toBeGreaterThan(10000)
  })

  it('пороги тиров — дистанции 30 и 150 пикселей, все меньше радиуса заселения', () => {
    for (const c of belt()) {
      expect(c.lodThresholdsKm.l1).toBeCloseTo(c.populationRadiusKm, 6)
      expect(c.lodThresholdsKm.l0).toBeCloseTo(c.typicalSizeKm / (30 * PIXEL_RAD), 6)
      expect(c.lodThresholdsKm.l0Near).toBeCloseTo(c.typicalSizeKm / (150 * PIXEL_RAD), 6)
      expect(c.lodThresholdsKm.l0NearExit).toBeGreaterThan(c.lodThresholdsKm.l0Near)
      expect(c.lodThresholdsKm.l0).toBeGreaterThan(c.lodThresholdsKm.l0NearExit)
    }
  })

  it('ячейка вмещает примерно 512 тел, высота ячейки равна ширине', () => {
    for (const c of belt()) {
      expect(c.cellSizeKm / c.spacingKm).toBeCloseTo(8, 6)
      expect(c.cellHeightKm).toBeCloseTo(c.cellSizeKm, 6)
    }
  })

  it('окно множителя отсчитывается от общего габарита — верха диапазона', () => {
    const c = belt()
    expect(c[2].maxScale).toBeCloseTo(1, 6)
    expect(c[0].minScale).toBeCloseTo(0.5 / 60, 6)
    expect(c[0].maxScale).toBeCloseTo(c[0].sizeRangeKm[1] / 60, 6)
  })

  it('вдвое меньший шаг требует восьмикратно больше экземпляров', () => {
    const dense = deriveCascades({ sizeRangeKm: [0.5, 60], spacingKm: 36.5 })
    expect(dense[0].instanceDemand / belt()[0].instanceDemand).toBeCloseTo(8, 1)
  })
})
