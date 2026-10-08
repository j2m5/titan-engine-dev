/**
 * Сетка источников блика: поток и центр яркости по ячейкам буфера локального
 * контраста, отбор локальных максимумов 3×3. CPU-зеркало проходов
 * FlareGridMaterial и FlareSelectMaterial — на нём тесты держат формулы.
 */

/** Строк сетки: ячейка — 1/36 высоты кадра (30 px на 1080p) */
export const FLARE_GRID_ROWS = 36

/** Высота кадра, в пикселях которой выражается поток для ручек и отчётов */
export const FLUX_REFERENCE_HEIGHT = 1080

/** Верхняя граница цикла сбора: текселей ячейки по оси (хватает до 8K) */
export const MAX_CELL_TEXELS = 64

/** Радиус окрестности локального контраста, тексели его буфера (LocalContrastMaterial) */
export const LOCAL_CONTRAST_RADIUS = 8

/**
 * Зеркало LocalContrastMaterial по яркости: тексель минус среднее четырёх
 * соседей на LOCAL_CONTRAST_RADIUS, не меньше нуля; за краем буфера —
 * крайний тексель (ClampToEdge).
 */
export function localContrast(texels: ArrayLike<number>, width: number, height: number): Float64Array {
  const r = LOCAL_CONTRAST_RADIUS
  const out = new Float64Array(width * height)

  for (let y = 0; y < height; y++) {
    const row = y * width
    const up = Math.min(y + r, height - 1) * width
    const down = Math.max(y - r, 0) * width
    for (let x = 0; x < width; x++) {
      const wide =
        0.25 * (texels[row + Math.min(x + r, width - 1)] + texels[row + Math.max(x - r, 0)] + texels[up + x] + texels[down + x])
      out[row + x] = Math.max(texels[row + x] - wide, 0)
    }
  }

  return out
}

export interface FlareGridSize {
  cols: number
  rows: number
}

/** Размер сетки по размеру буфера-источника; у вырожденного кадра аспект 1 */
export function flareGridSize(width: number, height: number): FlareGridSize {
  const cols = width > 0 && height > 0 ? Math.ceil((FLARE_GRID_ROWS * width) / height) : FLARE_GRID_ROWS

  return { cols: Math.max(1, cols), rows: FLARE_GRID_ROWS }
}

/** Координаты кадра: единица — высота кадра, ноль — центр */
export function frameCoord(u: number, v: number, aspect: number): [number, number] {
  return [(u - 0.5) * aspect, v - 0.5]
}

/** Поток в долях высоты кадра² → «пиксели 1080p × яркость» */
export function fluxToPixels(fluxFrame: number): number {
  return fluxFrame * FLUX_REFERENCE_HEIGHT * FLUX_REFERENCE_HEIGHT
}

export interface GatheredGrid {
  size: FlareGridSize
  /** Поток ячейки (по яркости), доли высоты кадра² */
  flux: Float64Array
  /** Центр яркости ячейки в координатах кадра: пары x, y */
  centroid: Float64Array
}

/**
 * Зеркало сбора: texels — яркость текселей буфера построчно снизу вверх (как
 * texelFetch). Границы ячейки — те же, что в шейдере: [floor(c·w), floor((c+1)·w)).
 */
export function gatherGrid(texels: ArrayLike<number>, width: number, height: number): GatheredGrid {
  const size = flareGridSize(width, height)
  const aspect = width / height
  const areaPerTexel = 1 / (height * height)
  const cellWidth = width / size.cols
  const cellHeight = height / size.rows
  const flux = new Float64Array(size.cols * size.rows)
  const centroid = new Float64Array(size.cols * size.rows * 2)

  for (let cy = 0; cy < size.rows; cy++) {
    for (let cx = 0; cx < size.cols; cx++) {
      const x0 = Math.floor(cx * cellWidth)
      const x1 = Math.min(width, Math.floor((cx + 1) * cellWidth))
      const y0 = Math.floor(cy * cellHeight)
      const y1 = Math.min(height, Math.floor((cy + 1) * cellHeight))
      let sum = 0
      let mx = 0
      let my = 0

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const l = texels[y * width + x]
          const [fx, fy] = frameCoord((x + 0.5) / width, (y + 0.5) / height, aspect)
          sum += l
          mx += l * fx
          my += l * fy
        }
      }

      const i = cy * size.cols + cx
      flux[i] = sum * areaPerTexel
      centroid[2 * i] = sum > 0 ? mx / sum : 0
      centroid[2 * i + 1] = sum > 0 ? my / sum : 0
    }
  }

  return { size, flux, centroid }
}

export interface FlareSource {
  cell: number
  /** Поток блока 3×3, доли высоты кадра² */
  flux: number
  /** Центр блока, взвешенный потоком, в координатах кадра */
  centroid: [number, number]
}

/**
 * Зеркало отбора: ячейка выбрана, если её поток > 0 и строго больше каждого из
 * 8 соседей (при равенстве выигрывает меньший индекс). Выбранная получает
 * поток и центр всего блока 3×3 — источник на границе ячеек не двоится.
 */
export function selectMaxima(grid: GatheredGrid): FlareSource[] {
  const { cols, rows } = grid.size
  const sources: FlareSource[] = []

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const index = cy * cols + cx
      const self = grid.flux[index]
      if (!(self > 0)) continue

      let isMax = true
      let sum = 0
      let mx = 0
      let my = 0

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue

          const n = ny * cols + nx
          const neighbour = grid.flux[n]
          if ((dx !== 0 || dy !== 0) && (neighbour > self || (neighbour === self && n < index))) isMax = false
          sum += neighbour
          mx += neighbour * grid.centroid[2 * n]
          my += neighbour * grid.centroid[2 * n + 1]
        }
      }

      if (isMax) sources.push({ cell: index, flux: sum, centroid: [mx / sum, my / sum] })
    }
  }

  return sources
}

/**
 * Полуширина окна источников в ячейках (±600 px 1080p). Копии одного
 * раздробленного диска лежат на кольце ~0.42 его диаметра: окно видит все
 * копии диска до ~700 px.
 */
export const SOURCE_WINDOW_CELLS = 20

export interface SourceWindow {
  /** Сумма потоков выбранных источников окна, доли высоты кадра² */
  flux: number
  /** Сумма их квадратов: (Σ)² / Σ² — эффективное число копий */
  fluxSquared: number
}

/** Зеркало FlareWindowMaterial: окно ±SOURCE_WINDOW_CELLS ячеек вокруг каждого выбранного источника */
export function sourceWindows(sources: readonly FlareSource[], size: FlareGridSize): SourceWindow[] {
  const at = (source: FlareSource): [number, number] => [source.cell % size.cols, Math.floor(source.cell / size.cols)]

  return sources.map((source) => {
    const [x, y] = at(source)
    let flux = 0
    let fluxSquared = 0
    for (const other of sources) {
      const [ox, oy] = at(other)
      if (Math.abs(ox - x) > SOURCE_WINDOW_CELLS || Math.abs(oy - y) > SOURCE_WINDOW_CELLS) continue
      flux += other.flux
      fluxSquared += other.flux * other.flux
    }
    return { flux, fluxSquared }
  })
}
