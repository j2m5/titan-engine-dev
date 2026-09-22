import { describe, it, expect } from 'vitest'
import { SectorGrid } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'

/** Кольцо: высота ячейки не задана — один слой во всю толщину, путь колец */
const flatGrid = (): SectorGrid =>
  new SectorGrid({ innerRadius: 35, outerRadius: 70, cellSize: 1, ringId: 1, densityPerUnit: 100, heightExtent: 0.5 })

/** Пояс: высота ячейки меньше толщины — слои появляются */
const volumeGrid = (): SectorGrid =>
  new SectorGrid({
    innerRadius: 35,
    outerRadius: 70,
    cellSize: 1,
    ringId: 1,
    densityPerUnit: 100,
    heightExtent: 20,
    cellHeight: 1
  })

describe('SectorGrid: вертикальные слои', () => {
  it('без cellHeight — один слой во всю толщину, ключ прежнего вида', () => {
    const grid = flatGrid()
    expect(grid.verticalLayerCount).toBe(1)
    expect(grid.volumetric).toBe(false)

    const info = grid.getSectorInfo(0, 0, 0)
    expect(info.key).toBe('0_0')
    expect(info.centerY).toBe(0)
    expect(info.bounds.minY).toBeCloseTo(-0.25, 10)
    expect(info.bounds.maxY).toBeCloseTo(0.25, 10)
  })

  it('с cellHeight — слои нарезаны от −h/2 до +h/2, ключ несёт третий индекс', () => {
    const grid = volumeGrid()
    expect(grid.verticalLayerCount).toBe(20)
    expect(grid.volumetric).toBe(true)

    const bottom = grid.getSectorInfo(0, 0, 0)
    expect(bottom.bounds.minY).toBeCloseTo(-10, 10)
    expect(bottom.bounds.maxY).toBeCloseTo(-9, 10)
    expect(bottom.centerY).toBeCloseTo(-9.5, 10)
    expect(bottom.key).toBe('0_0_0')

    const top = grid.getSectorInfo(0, 0, 19)
    expect(top.bounds.maxY).toBeCloseTo(10, 10)
    expect(top.centerY).toBeCloseTo(9.5, 10)
  })

  it('индекс слоя вне диапазона — RangeError', () => {
    expect(() => volumeGrid().getSectorInfo(0, 0, 20)).toThrow(RangeError)
    expect(() => volumeGrid().getSectorInfo(0, 0, -1)).toThrow(RangeError)
  })

  it('окно по высоте — надмножество точного отбора, дальние слои отброшены', () => {
    const grid = volumeGrid()
    // Камера в средней плоскости, радиус внутри пояса, дальность 2 — по высоте
    // должны попасть только слои, чья ближайшая точка не дальше 2
    const found = grid.getSectorsInRange(0, 52, 0, 2)
    const yIndices = new Set(found.map((s) => s.yIndex))

    for (const yi of yIndices) {
      const info = grid.getSectorInfo(0, 0, yi)
      const closest = Math.max(info.bounds.minY, Math.min(info.bounds.maxY, 0))
      expect(Math.abs(closest)).toBeLessThanOrEqual(2)
    }
    // Слой у самого края (центр −9.5) заведомо вне дальности
    expect(yIndices.has(0)).toBe(false)
  })

  it('камера выше пояса — секторов нет вовсе', () => {
    expect(volumeGrid().getSectorsInRange(0, 52, 40, 2)).toEqual([])
  })

  it('bounding sphere объёмной ячейки учитывает высоту, плоской — нет', () => {
    const flat = flatGrid().getSectorInfo(0, 0, 0)
    const volume = volumeGrid().getSectorInfo(0, 0, 10)
    // Плоская: половина диагонали прямоугольника радиус×дуга, высота не входит
    expect(flat.boundingRadius).toBeLessThan(1)
    // Объёмная: та же диагональ плюс высота ячейки
    expect(volume.boundingRadius).toBeGreaterThan(flat.boundingRadius)
  })
})
