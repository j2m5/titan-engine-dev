import { gaiaTileByteLength, type GaiaTile } from '@/core/sky/gaiaTiles'

export type GaiaTileFetcher = (tile: GaiaTile, signal?: AbortSignal) => Promise<ArrayBuffer>

export interface GaiaLoadResult {
  loaded: number
  failed: GaiaTile[]
  /** Первый тайл не пришёл — тайлов нет вовсе, остальные не запрашивались */
  aborted: boolean
  /** Владелец отменил загрузку; это не ошибка доступности тайлов */
  cancelled: boolean
}

/**
 * Загрузка тайлов: первый — отдельно, затем до `concurrency` запросов разом в
 * порядке списка. Тайл неверной длины (HTML-заглушка dev-сервера) — отказ.
 * Разбор — без копии: платформы WebGL little-endian, как и данные.
 * Отмена останавливает запросы, повторы и очередь; поздние ответы отбрасываются.
 */
export async function loadGaiaTiles(
  tiles: readonly GaiaTile[],
  fetchTile: GaiaTileFetcher,
  onTile: (tile: GaiaTile, data: Uint32Array) => void,
  { concurrency = 6, retries = 2, signal }: { concurrency?: number; retries?: number; signal?: AbortSignal } = {}
): Promise<GaiaLoadResult> {
  const failed: GaiaTile[] = []
  let loaded = 0
  const result = (): GaiaLoadResult => ({ loaded, failed, aborted: false, cancelled: signal?.aborted ?? false })

  const attempt = async (tile: GaiaTile): Promise<boolean> => {
    for (let i = 0; i <= retries; i++) {
      if (signal?.aborted) return false
      try {
        const buffer = await fetchTile(tile, signal)
        if (signal?.aborted) return false
        if (buffer.byteLength !== gaiaTileByteLength(tile)) {
          throw new Error(`${tile.name}: ${buffer.byteLength} байт`)
        }
        onTile(tile, new Uint32Array(buffer))
        loaded++
        return true
      } catch {
        if (signal?.aborted) return false
        // следующая попытка
      }
    }
    failed.push(tile)
    return false
  }

  if (tiles.length === 0) return result()
  if (!(await attempt(tiles[0]))) {
    return signal?.aborted ? result() : { ...result(), failed: [...tiles], aborted: true }
  }

  let next = 1
  const worker = async (): Promise<void> => {
    while (next < tiles.length && !signal?.aborted) {
      const tile = tiles[next++]
      await attempt(tile)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length - 1) }, worker))
  return result()
}
