import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SectorGrid } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { fromAstronomicalUnits, toThreeJSUnits } from '@/core/helpers/scaling'

describe('SectorGrid — ленивые слои', () => {
  const beltInner: number = fromAstronomicalUnits(42)
  const beltOuter: number = fromAstronomicalUnits(58)
  const cell: number = toThreeJSUnits(2000)

  it('пояс шириной 16 а.е. создаётся мгновенно и не аллоцирует слои', () => {
    const t0: number = performance.now()
    const grid = new SectorGrid({ innerRadius: beltInner, outerRadius: beltOuter, cellSize: cell, ringId: 11, densityPerUnit: 1 })

    expect(performance.now() - t0).toBeLessThan(50)
    expect(grid.layerCount).toBeGreaterThan(1_000_000)
    expect((grid as unknown as { layers?: unknown }).layers).toBeUndefined()
  })

  it('окно кандидатов вокруг камеры — считанные слои, а не все', () => {
    const grid = new SectorGrid({ innerRadius: beltInner, outerRadius: beltOuter, cellSize: cell, ringId: 11, densityPerUnit: 1 })
    const maxDistance: number = toThreeJSUnits(12000)
    const camR: number = fromAstronomicalUnits(50)
    const sectors = grid.getSectorsInRange(0.3, camR, maxDistance)
    const layerIndices = new Set(sectors.map((s) => s.layerIndex))

    expect(layerIndices.size).toBeLessThanOrEqual(2 * Math.ceil(maxDistance / cell) + 3)
    expect(sectors.length).toBeGreaterThan(0)
    for (const s of sectors) {
      expect(Math.abs(s.centerRadius - camR)).toBeLessThanOrEqual(maxDistance + s.boundingRadius)
    }
  })

  it('слой по индексу совпадает с прежней равномерной разбивкой', () => {
    const grid = new SectorGrid({ innerRadius: 100, outerRadius: 200, cellSize: 10, ringId: 1, densityPerUnit: 1 })
    const layer = grid.layerAt(3)

    expect(grid.layerCount).toBe(10)
    expect(layer.innerRadius).toBeCloseTo(130, 10)
    expect(layer.outerRadius).toBeCloseTo(140, 10)
    expect(layer.angularSectorCount).toBe(Math.max(6, Math.round((2 * Math.PI * 135) / 10)))
  })

  it('кольцо: тот же набор кандидатов, что и раньше (пин)', () => {
    // Сатурн: 74 500–140 220 км, ячейка 2000 км, камера на 100 000 км, окно 12 000 км
    const grid = new SectorGrid({ innerRadius: toThreeJSUnits(74500), outerRadius: toThreeJSUnits(140220), cellSize: cell, ringId: 39, densityPerUnit: 500 })
    const sectors = grid.getSectorsInRange(1.0, toThreeJSUnits(100000), toThreeJSUnits(12000))
    const keys = sectors.map((s) => s.key).sort()

    expect(keys.length).toBeGreaterThan(50)
    // Снимок ключей до правки — записан на HEAD (2d4e706) throwaway-скриптом, см. отчёт задачи
    expect(keys).toEqual(JSON.parse(readFileSync('tests/asteroidBelt/fixtures/saturnSectorKeys.json', 'utf8')))
  })
})
