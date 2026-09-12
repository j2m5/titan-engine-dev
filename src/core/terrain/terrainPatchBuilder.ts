import type { TerrainHeightField } from './TerrainHeightField'
import type { DetailWrap } from './detailWrap'
import { allocatePatchArrays, buildTerrainPatchArrays, type PatchArrays, type PatchBounds } from './terrainPatchGeometry'

/** Задание на сборку одного патча — всё, что нужно ядру мешера (см. buildTerrainPatchArrays). */
export interface PatchBuildJob {
  field: TerrainHeightField
  face: number
  i: number
  j: number
  level: number
  segments: number
  skirtDepthUnits: number
  wrap: DetailWrap
}

/** Результат сборки: массивы атрибутов, RTC-центр патча (тройка, не Vector3 — переживает structured clone) и сфера. */
export interface PatchBuildResult {
  arrays: PatchArrays
  center: [number, number, number]
  bounds: PatchBounds
}

/**
 * Строитель патчей: синхронный (тесты, вода, фолбэк без Worker) или
 * воркерный. `onDone` зовётся ровно один раз на запрос; вызывающий сам решает,
 * нужен ли результат ещё (узел мог выйти из желаемого набора, группа —
 * освободиться).
 */
export interface TerrainPatchBuilder {
  /** Группа заявляет владение полем (конструктор); парный release — в dispose. Счётчик ссылок у воркерного строителя. */
  acquire(field: TerrainHeightField): void
  request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void): void
  release(field: TerrainHeightField): void
  releaseAll(): void
  dispose(): void
}

/** Постройка на месте: onDone внутри request — семантика «одна постройка за кадр» прежних стендов. */
export class SyncTerrainPatchBuilder implements TerrainPatchBuilder {
  public acquire(): void {}

  public request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void): void {
    const arrays = allocatePatchArrays(job.segments)
    const { center, bounds } = buildTerrainPatchArrays(
      job.field,
      job.face,
      job.i,
      job.j,
      job.level,
      job.segments,
      job.skirtDepthUnits,
      job.wrap,
      arrays
    )
    onDone({ arrays, center: [center.x, center.y, center.z], bounds })
  }

  public release(): void {}

  public releaseAll(): void {}

  public dispose(): void {}
}
