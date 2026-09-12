import { SyncTerrainPatchBuilder, type PatchBuildJob, type PatchBuildResult, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import type { TerrainHeightField } from '@/core/terrain/TerrainHeightField'

/** Очередь заданий с ручным продвижением: flush(n) завершает n первых через синхронный строитель. */
export class FakeAsyncBuilder implements TerrainPatchBuilder {
  public readonly acquired: TerrainHeightField[] = []
  public readonly released: TerrainHeightField[] = []
  private readonly queue: Array<{ job: PatchBuildJob; onDone: (r: PatchBuildResult) => void }> = []
  private readonly sync = new SyncTerrainPatchBuilder()

  public acquire(field: TerrainHeightField): void {
    this.acquired.push(field)
  }

  public request(job: PatchBuildJob, onDone: (r: PatchBuildResult) => void): void {
    this.queue.push({ job, onDone })
  }

  public flush(n: number = Infinity): void {
    for (const { job, onDone } of this.queue.splice(0, n)) this.sync.request(job, onDone)
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
