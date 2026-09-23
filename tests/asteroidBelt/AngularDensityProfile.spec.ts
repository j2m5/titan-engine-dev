import { describe, it, expect } from 'vitest'
import { AngularDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/AngularDensityProfile'
import { buildBeltAngularProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'
import { SeededRandom } from '@/core/renderables/DetailedRingStreamingSystem/SeededRandom'

const TWO_PI = Math.PI * 2
const flat = { edgeSoftness: 0, gaps: [], clumps: [] }

/** Одна дуга на четверти оборота (угол π/2), σ = 0.05 оборота */
const ARC = { at: 0.25, width: 0.05, gain: 2 }
const arcBins = (): Float32Array => buildBeltAngularProfile({ ...flat, arcs: [ARC] })!

describe('AngularDensityProfile.weightForRange', () => {
  it('среднее по полному обороту — 1 (профиль нормирован)', () => {
    const p = new AngularDensityProfile(arcBins())
    expect(p.weightForRange(0, TWO_PI)).toBeCloseTo(1, 5)
    expect(p.weightForRange(1, 1 + TWO_PI)).toBeCloseTo(1, 5)
    expect(p.weightForRange(-3, 20)).toBeCloseTo(1, 5)
  })

  it('внутри дуги вес > 1, напротив дуги < 1', () => {
    const p = new AngularDensityProfile(arcBins())
    const half = 0.01 * TWO_PI
    expect(p.weightForRange(Math.PI / 2 - half, Math.PI / 2 + half)).toBeGreaterThan(1.5)
    expect(p.weightForRange(1.5 * Math.PI - half, 1.5 * Math.PI + half)).toBeLessThan(1)
  })

  it('интервал через 0/2π равен тому же интервалу, сдвинутому на оборот', () => {
    const bins = buildBeltAngularProfile({ ...flat, arcs: [{ at: 0.98, width: 0.03, gain: 3 }] })!
    const p = new AngularDensityProfile(bins)
    const a = p.weightForRange(-0.2, 0.2)
    const b = p.weightForRange(TWO_PI - 0.2, TWO_PI + 0.2)
    const c = p.weightForRange(TWO_PI - 0.2, 0.2)

    expect(a).toBeCloseTo(b, 6)
    expect(a).toBeCloseTo(c, 6)
    expect(a).toBeGreaterThan(1.5)
  })

  it('a1 < a0 больше чем на оборот назад — дуга вперёд от a0 по кругу, не вес в точке', () => {
    const bins = buildBeltAngularProfile({ ...flat, arcs: [{ at: 0.98, width: 0.03, gain: 3 }] })!
    const p = new AngularDensityProfile(bins)

    // 10 → 0 по кругу вперёд = интервал [10, 4π] длиной 2.57 рад, он захватывает дугу у 0.98 оборота
    expect(p.weightForRange(10, 0)).toBeCloseTo(p.weightForRange(10, 4 * Math.PI), 6)
    expect(p.weightForRange(10, 0)).toBeGreaterThan(p.weightForRange(10, 10))
  })

  it('ровный профиль — единица на любом интервале', () => {
    const p = new AngularDensityProfile(new Float32Array(16).fill(1))
    expect(p.weightForRange(0.3, 0.31)).toBeCloseTo(1, 6)
    expect(p.weightForRange(6, 0.5)).toBeCloseTo(1, 6)
  })

  it('пустой профиль — ошибка конструктора', () => {
    expect(() => new AngularDensityProfile(new Float32Array(0))).toThrow()
  })
})

describe('AngularDensityProfile.sampleAngle', () => {
  const histogram = (p: AngularDensityProfile, samples: number, cells: number): number[] => {
    const rng = new SeededRandom(5)
    const counts = new Array<number>(cells).fill(0)
    let outOfRange = 0
    for (let i = 0; i < samples; i++) {
      const theta = p.sampleAngle(rng.next())
      if (theta < 0 || theta >= TWO_PI) outOfRange++
      else counts[Math.floor((theta / TWO_PI) * cells)]++
    }
    expect(outOfRange).toBe(0)
    return counts
  }

  it('гистограмма 100k розыгрышей следует профилю (относительная ошибка < 10% на ячейку)', () => {
    const bins = arcBins()
    const p = new AngularDensityProfile(bins)
    const cells = 32
    const samples = 100000
    const counts = histogram(p, samples, cells)

    for (let c = 0; c < cells; c++) {
      // Ожидание ячейки — средний вес её интервала (профиль нормирован к 1)
      const expected = (samples / cells) * p.weightForRange((c / cells) * TWO_PI, ((c + 1) / cells) * TWO_PI)
      expect(Math.abs(counts[c] - expected) / expected).toBeLessThan(0.1)
    }
    // Пик — ячейка с π/2, напротив — заметно реже
    const peak = Math.floor(0.25 * cells)
    const opposite = Math.floor(0.75 * cells)
    expect(counts[peak] / counts[opposite]).toBeGreaterThan(1.8)
  })

  it('ровный профиль — равномерно по обороту', () => {
    const p = new AngularDensityProfile(new Float32Array(64).fill(1))
    const cells = 16
    const counts = histogram(p, 100000, cells)
    for (const c of counts) expect(Math.abs(c - 100000 / cells) / (100000 / cells)).toBeLessThan(0.05)
  })

  it('u = 0 → 0, u → 1 остаётся в [0, 2π); нулевая масса — равномерно', () => {
    const p = new AngularDensityProfile(arcBins())
    expect(p.sampleAngle(0)).toBe(0)
    expect(p.sampleAngle(1 - 1e-12)).toBeLessThan(TWO_PI)
    const empty = new AngularDensityProfile(new Float32Array(8))
    expect(empty.sampleAngle(0.25)).toBeCloseTo(Math.PI / 2, 12)
  })
})
