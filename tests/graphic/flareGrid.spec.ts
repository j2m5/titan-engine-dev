import { describe, expect, it } from 'vitest'
import {
  FLARE_GRID_ROWS,
  MAX_CELL_TEXELS,
  flareGridSize,
  fluxToPixels,
  frameCoord,
  gatherGrid,
  selectMaxima,
  type GatheredGrid
} from '@/core/graphic/effects/lensflare/flareGrid'

/** Гауссово пятно яркости peak с центром (cx, cy) в текселях, обрезанное на 5σ */
function blobTexels(width: number, height: number, cx: number, cy: number, sigma: number, peak: number): Float64Array {
  const texels = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
      if (d2 <= (5 * sigma) ** 2) texels[y * width + x] = peak * Math.exp(-d2 / (2 * sigma * sigma))
    }
  }
  return texels
}

function add(a: Float64Array, b: Float64Array): Float64Array {
  return a.map((v, i) => v + b[i])
}

/** Поток всего кадра в долях высоты кадра² */
function totalFlux(texels: Float64Array, height: number): number {
  return texels.reduce((sum, v) => sum + v, 0) / (height * height)
}

describe('сетка источников: размер', () => {
  it('строк 36, столбцов по аспекту кадра', () => {
    expect(flareGridSize(960, 540)).toEqual({ cols: 64, rows: FLARE_GRID_ROWS })
    expect(flareGridSize(1280, 540)).toEqual({ cols: 86, rows: FLARE_GRID_ROWS })
  })

  it('вырожденный кадр: сетка конечна, аспект 1', () => {
    expect(flareGridSize(0, 0)).toEqual({ cols: 36, rows: 36 })
    expect(flareGridSize(1, 1).cols).toBeGreaterThanOrEqual(1)
  })

  it('ячейка до 8K влезает в цикл сбора', () => {
    const { cols, rows } = flareGridSize(3840, 2160)
    expect(Math.ceil(3840 / cols)).toBeLessThanOrEqual(MAX_CELL_TEXELS)
    expect(Math.ceil(2160 / rows)).toBeLessThanOrEqual(MAX_CELL_TEXELS)
  })
})

describe('сетка источников: поток', () => {
  it('поток не зависит от разрешения: одно пятно в 540 и 720 строк', () => {
    const a = blobTexels(960, 540, 0.3 * 960, 0.6 * 540, 0.004 * 540, 10)
    const b = blobTexels(1280, 720, 0.3 * 1280, 0.6 * 720, 0.004 * 720, 10)
    const fa = gatherGrid(a, 960, 540).flux.reduce((s, v) => s + v, 0)
    const fb = gatherGrid(b, 1280, 720).flux.reduce((s, v) => s + v, 0)

    expect(fb / fa).toBeCloseTo(1, 3)
  })

  it('поток в пикселях 1080p: пиксель 1080p яркости 1 — единица', () => {
    expect(fluxToPixels(1 / 1080 ** 2)).toBeCloseTo(1, 12)
  })

  it('центр кадра в координатах кадра — ноль', () => {
    expect(frameCoord(0.5, 0.5, 16 / 9)).toEqual([0, 0])
    expect(frameCoord(1, 1, 2)).toEqual([1, 0.5])
  })
})

describe('сетка источников: отбор максимумов', () => {
  it('источник, идущий через границы ячеек, всегда даёт ровно один выбор с полным потоком', () => {
    const width = 960
    const height = 540
    for (let step = 0; step <= 20; step++) {
      const cx = 30 * 15 + (step / 20) * 30
      const cy = 17.3 * 15
      const texels = blobTexels(width, height, cx, cy, 2.5, 10)
      const sources = selectMaxima(gatherGrid(texels, width, height))
      const expected = frameCoord(cx / width, cy / height, width / height)

      expect(sources, `шаг ${step}`).toHaveLength(1)
      expect(sources[0].flux / totalFlux(texels, height)).toBeCloseTo(1, 6)
      expect(sources[0].centroid[0]).toBeCloseTo(expected[0], 5)
      expect(sources[0].centroid[1]).toBeCloseTo(expected[1], 5)
    }
  })

  it('источник в центре кадра, на стыке четырёх ячеек, — один выбор в нуле', () => {
    const texels = blobTexels(960, 540, 480, 270, 2, 10)
    const [source] = selectMaxima(gatherGrid(texels, 960, 540))

    expect(source.centroid[0]).toBeCloseTo(0, 5)
    expect(source.centroid[1]).toBeCloseTo(0, 5)
  })

  it('две далёкие звезды — два выбора', () => {
    const texels = add(blobTexels(960, 540, 200, 100, 2, 10), blobTexels(960, 540, 700, 400, 2, 10))

    expect(selectMaxima(gatherGrid(texels, 960, 540))).toHaveLength(2)
  })

  it('две близкие звезды в одном блоке — один выбор с суммой потока в центре, взвешенном потоком', () => {
    const bright = blobTexels(960, 540, 452, 262, 2, 10)
    const dim = blobTexels(960, 540, 470, 262, 2, 5)
    const texels = add(bright, dim)
    const sources = selectMaxima(gatherGrid(texels, 960, 540))
    const fb = totalFlux(bright, 540)
    const fd = totalFlux(dim, 540)
    const x = (fb * frameCoord(452 / 960, 0, 960 / 540)[0] + fd * frameCoord(470 / 960, 0, 960 / 540)[0]) / (fb + fd)

    expect(sources).toHaveLength(1)
    expect(sources[0].flux / (fb + fd)).toBeCloseTo(1, 6)
    expect(sources[0].centroid[0]).toBeCloseTo(x, 5)
  })

  it('источник в углу кадра выбирается: соседи за краем сетки не считаются', () => {
    const texels = blobTexels(960, 540, 3, 3, 1.5, 10)
    const sources = selectMaxima(gatherGrid(texels, 960, 540))

    expect(sources).toHaveLength(1)
    expect(sources[0].cell).toBe(0)
  })

  it('пустой кадр — ни одного выбора', () => {
    expect(selectMaxima(gatherGrid(new Float64Array(960 * 540), 960, 540))).toHaveLength(0)
  })

  it('равные соседи: выигрывает меньший индекс, выбор один', () => {
    const flux = new Float64Array(12)
    flux[5] = 1
    flux[6] = 1
    const grid: GatheredGrid = { size: { cols: 4, rows: 3 }, flux, centroid: new Float64Array(24) }
    const sources = selectMaxima(grid)

    expect(sources).toHaveLength(1)
    expect(sources[0].cell).toBe(5)
    expect(sources[0].flux).toBe(2)
  })

  it('плато: равномерная полоса даёт конечные выборы без NaN', () => {
    const texels = new Float64Array(960 * 540)
    for (let y = 100; y < 110; y++) for (let x = 0; x < 960; x++) texels[y * 960 + x] = 5
    const sources = selectMaxima(gatherGrid(texels, 960, 540))

    expect(sources.length).toBeGreaterThan(0)
    for (const s of sources) {
      expect(Number.isFinite(s.flux)).toBe(true)
      expect(Number.isFinite(s.centroid[0]) && Number.isFinite(s.centroid[1])).toBe(true)
    }
  })
})
