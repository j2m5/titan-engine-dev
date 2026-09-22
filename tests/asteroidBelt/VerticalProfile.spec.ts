import { describe, it, expect } from 'vitest'
import { triangularMass } from '@/core/renderables/DetailedRingStreamingSystem/triangularMass'
import { SectorGrid } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'

describe('triangularMass', () => {
  it('вся полоса — единица, половина по симметрии — половина', () => {
    expect(triangularMass(-4, 4, 4)).toBeCloseTo(1, 12)
    expect(triangularMass(-4, 0, 4)).toBeCloseTo(0.5, 12)
    expect(triangularMass(0, 4, 4)).toBeCloseTo(0.5, 12)
  })

  it('за пределами — ноль, выход за край клампится', () => {
    expect(triangularMass(5, 9, 4)).toBe(0)
    expect(triangularMass(-9, 9, 4)).toBeCloseTo(1, 12)
  })

  it('центральная полоса тяжелее краевой той же ширины', () => {
    const center = triangularMass(-0.5, 0.5, 10)
    const edge = triangularMass(9, 10, 10)
    expect(center).toBeGreaterThan(edge)
  })

  it('сумма по равным полосам даёт единицу', () => {
    const n = 20
    const half = 10
    let sum = 0
    for (let i = 0; i < n; i++) sum += triangularMass(-half + (i * 2 * half) / n, -half + ((i + 1) * 2 * half) / n, half)
    expect(sum).toBeCloseTo(1, 12)
  })
})

describe('SectorGrid: число камней по высоте', () => {
  const make = (cellHeight?: number): SectorGrid =>
    new SectorGrid({
      innerRadius: 35,
      outerRadius: 70,
      cellSize: 1,
      ringId: 1,
      densityPerUnit: 4000,
      heightExtent: 20,
      cellHeight
    })

  it('один слой — вес по высоте единица, счёт прежний', () => {
    const flat = make()
    const volume = make(1)
    const flatCount = flat.getSectorInfo(5, 3, 0).instanceCount
    let volumeSum = 0
    for (let yi = 0; yi < volume.verticalLayerCount; yi++) volumeSum += volume.getSectorInfo(5, 3, yi).instanceCount

    // Колонка объёмной сетки в сумме даёт примерно тот же счёт, что плоская ячейка
    expect(volumeSum).toBeGreaterThan(flatCount * 0.9)
    expect(volumeSum).toBeLessThan(flatCount * 1.1)
  })

  it('ячейка у средней плоскости населена гуще краевой', () => {
    const grid = make(1)
    const middle = grid.getSectorInfo(5, 3, 10).instanceCount
    const edge = grid.getSectorInfo(5, 3, 0).instanceCount
    expect(middle).toBeGreaterThan(edge)
  })
})
