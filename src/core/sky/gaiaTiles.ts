/**
 * Тайлы неба Gaia в формате загрузчика Брунетона (gaia_sky_map). Кубмапа 2048²,
 * уровни 0…11; файлы есть у уровней 0…4: уровни 0…3 нарезаны тайлами 256²,
 * файл уровня 4 несёт хвост уровней 4…11. Внутри по уровням подряд: тексели
 * галактики, затем звёзд; тексель — RGB9_E5 (uint32 little-endian)
 */

/** Порядок граней = TEXTURE_CUBE_MAP_POSITIVE_X + индекс */
export const GAIA_FACES = ['pos-x', 'neg-x', 'pos-y', 'neg-y', 'pos-z', 'neg-z'] as const
export const GAIA_CUBE_SIZE = 2048
/** Уровней мипмапов: 2048 → 1 */
export const GAIA_LEVELS = 12
export const GAIA_TILE_SIZE = 256
/** Последний уровень со своими файлами; более грубые — в его хвосте */
export const GAIA_LAST_FILE_LEVEL = 4
/** Звёзды уровней 0…6 — суммы потока (ручной фильтр), 7…11 — средние */
export const GAIA_MAX_FINE_STAR_LEVEL = 6

export interface GaiaTile {
  readonly face: number
  readonly level: number
  readonly i: number
  readonly j: number
  readonly name: string
}

export type GaiaTextureKey = 'galaxy' | 'stars' | 'starsCoarse'

export interface GaiaTileLevel {
  readonly level: number
  readonly size: number
  readonly galaxy: Uint32Array
  readonly stars: Uint32Array
}

export interface GaiaUpload {
  readonly texture: GaiaTextureKey
  readonly face: number
  /** Уровень в СВОЕЙ текстуре: у грубых звёзд уровень 7 — это 0 */
  readonly level: number
  readonly x: number
  readonly y: number
  readonly size: number
  readonly data: Uint32Array
}

function levelSize(level: number): number {
  return GAIA_CUBE_SIZE >> level
}

function tileSize(level: number): number {
  return Math.min(GAIA_TILE_SIZE, levelSize(level))
}

function tilesPerAxis(level: number): number {
  return levelSize(level) / tileSize(level)
}

/** Уровни, которые несёт файл уровня `level`, с размером тайла */
function fileLevels(level: number): Array<{ level: number; size: number }> {
  const levels = [{ level, size: tileSize(level) }]
  if (levelSize(level) < GAIA_TILE_SIZE) {
    for (let next = level + 1; next < GAIA_LEVELS; next++) levels.push({ level: next, size: levelSize(next) })
  }
  return levels
}

/** Тайлы в порядке загрузки: от грубого уровня к тонкому */
export function gaiaTiles(): GaiaTile[] {
  const tiles: GaiaTile[] = []
  for (let level = GAIA_LAST_FILE_LEVEL; level >= 0; level--) {
    const count = tilesPerAxis(level)
    for (let face = 0; face < GAIA_FACES.length; face++) {
      for (let j = 0; j < count; j++) {
        for (let i = 0; i < count; i++) {
          tiles.push({ face, level, i, j, name: `${GAIA_FACES[face]}-${level}-${i}-${j}` })
        }
      }
    }
  }
  return tiles
}

export function gaiaTileByteLength(tile: Pick<GaiaTile, 'level'>): number {
  const texels = fileLevels(tile.level).reduce((sum, { size }) => sum + 2 * size * size, 0)
  return texels * Uint32Array.BYTES_PER_ELEMENT
}

/** Файл → уровни; подмассивы без копирования */
export function splitGaiaTile(level: number, data: Uint32Array): GaiaTileLevel[] {
  const levels: GaiaTileLevel[] = []
  let offset = 0
  for (const { level: current, size } of fileLevels(level)) {
    const count = size * size
    levels.push({
      level: current,
      size,
      galaxy: data.subarray(offset, offset + count),
      stars: data.subarray(offset + count, offset + 2 * count)
    })
    offset += 2 * count
  }
  if (offset !== data.length) {
    throw new Error(`Тайл уровня ${level}: ${data.length} текселей вместо ${offset}`)
  }
  return levels
}

/** Галактика — всегда; звёзды 0…6 — в «звёзды», 7…11 — в «грубые» с их уровня 0 */
export function planGaiaUploads(tile: GaiaTile, data: Uint32Array): GaiaUpload[] {
  return splitGaiaTile(tile.level, data).flatMap(({ level, size, galaxy, stars }): GaiaUpload[] => {
    const x = tile.i * size
    const y = tile.j * size
    const fine = level <= GAIA_MAX_FINE_STAR_LEVEL
    return [
      { texture: 'galaxy', face: tile.face, level, x, y, size, data: galaxy },
      {
        texture: fine ? 'stars' : 'starsCoarse',
        face: tile.face,
        level: fine ? level : level - GAIA_MAX_FINE_STAR_LEVEL - 1,
        x,
        y,
        size,
        data: stars
      }
    ]
  })
}

/** Учёт загруженных файлов по уровням */
export class GaiaLevelTracker {
  private readonly loaded = new Map<number, Set<string>>()

  public markLoaded(tile: GaiaTile): void {
    let names = this.loaded.get(tile.level)
    if (!names) {
      names = new Set<string>()
      this.loaded.set(tile.level, names)
    }
    names.add(tile.name)
  }

  /**
   * Наименьший уровень L, у которого загружены файлы всех уровней ≥ L на всех
   * гранях (уровни 5…11 едут в файле уровня 4); ничего — Infinity
   */
  public completeLevel(): number {
    let complete = Infinity
    for (let level = GAIA_LAST_FILE_LEVEL; level >= 0; level--) {
      const expected = GAIA_FACES.length * tilesPerAxis(level) ** 2
      if ((this.loaded.get(level)?.size ?? 0) < expected) break
      complete = level
    }
    return complete
  }
}
