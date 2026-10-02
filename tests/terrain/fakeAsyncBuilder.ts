import { SyncTerrainPatchBuilder, type PatchBuildJob, type PatchBuildResult, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import type { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { NearTileParams } from '@/core/terrain/nearTileBake'
import type { ShadowHeightBits } from '@/core/terrain/terrainShadowBits'

/**
 * Очередь заданий с ручным продвижением: flush(n) завершает n первых через
 * синхронный строитель. Тот отдаёт свой скретч-набор массивов, но onDone здесь
 * тоже потребляется синхронно (внутри flush) — контракт «массивы живут только
 * на время onDone» соблюдён, перекрытия заданий нет.
 */
export class FakeAsyncBuilder implements TerrainPatchBuilder {
  public readonly acquired: TerrainHeightField[] = []
  public readonly released: TerrainHeightField[] = []
  private readonly queue: Array<{ job: PatchBuildJob; onDone: (r: PatchBuildResult) => void; onError: (e: unknown) => void }> = []
  private readonly sync = new SyncTerrainPatchBuilder()

  public acquire(field: TerrainHeightField): void {
    this.acquired.push(field)
  }

  public request(job: PatchBuildJob, onDone: (r: PatchBuildResult) => void, onError: (e: unknown) => void): void {
    this.queue.push({ job, onDone, onError })
  }

  /** Карта тени — синхронно: очередь моделирует только постройку патчей. */
  public requestShadow(field: TerrainHeightField, onDone: (bits: ShadowHeightBits) => void): void {
    this.sync.requestShadow(field, onDone)
  }

  /** Плитка — синхронно, как карта тени. */
  public requestNearTile(
    field: TerrainHeightField,
    params: NearTileParams,
    onDone: (heights: Float32Array) => void,
    onError: (e: unknown) => void
  ): void {
    this.sync.requestNearTile(field, params, onDone, onError)
  }

  public flush(n: number = Infinity): void {
    for (const { job, onDone, onError } of this.queue.splice(0, n)) this.sync.request(job, onDone, onError)
  }

  public get queued(): number {
    return this.queue.length
  }

  public release(field: TerrainHeightField): void {
    this.released.push(field)
  }

  public releaseAll(): void {}

  public dispose(): void {}
}
