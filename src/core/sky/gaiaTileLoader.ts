import { gaiaTileByteLength, type GaiaTile } from '@/core/sky/gaiaTiles'

export type GaiaTileFetcher = (tile: GaiaTile) => Promise<ArrayBuffer>

export interface GaiaLoadResult {
  loaded: number
  failed: GaiaTile[]
  /** Первый тайл не пришёл — тайлов нет вовсе, остальные не запрашивались */
  aborted: boolean
}

/**
 * Загрузка тайлов: первый — отдельно, затем до `concurrency` запросов разом в
 * порядке списка. Тайл неверной длины (HTML-заглушка dev-сервера) — отказ.
 * Разбор — без копии: платформы WebGL little-endian, как и данные
 */
export async function loadGaiaTiles(
  tiles: readonly GaiaTile[],
  fetchTile: GaiaTileFetcher,
  onTile: (tile: GaiaTile, data: Uint32Array) => void,
  concurrency: number = 6,
  retries: number = 2
): Promise<GaiaLoadResult> {
  const failed: GaiaTile[] = []
  let loaded = 0

  const attempt = async (tile: GaiaTile): Promise<boolean> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const buffer = await fetchTile(tile)
        if (buffer.byteLength !== gaiaTileByteLength(tile)) {
          throw new Error(`${tile.name}: ${buffer.byteLength} байт`)
        }
        onTile(tile, new Uint32Array(buffer))
        loaded++
        return true
      } catch {
        // следующая попытка
      }
    }
    failed.push(tile)
    return false
  }

  if (tiles.length === 0) return { loaded, failed, aborted: false }
  if (!(await attempt(tiles[0]))) return { loaded, failed: [...tiles], aborted: true }

  let next = 1
  const worker = async (): Promise<void> => {
    while (next < tiles.length) {
      const tile = tiles[next++]
      await attempt(tile)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length - 1) }, worker))
  return { loaded, failed, aborted: false }
}
